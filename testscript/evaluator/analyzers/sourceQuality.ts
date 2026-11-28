/** TypeScript-aware checks for explicit escapes, module boundaries, and export documentation. */

import ts from 'typescript';
import type { DeductionItem } from '../types.js';
import { makeDeduction } from '../utils.js';

const DOMAIN_BANNED = ['react', 'react-dom', 'node:', 'express', '@google/genai'];
const CLIENT_BANNED = ['@google/genai', 'dotenv'];

function getImport(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    const spec = node.moduleSpecifier;
    return spec && ts.isStringLiteral(spec) ? spec.text : undefined;
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const spec = node.arguments[0];
    return spec && ts.isStringLiteral(spec) ? spec.text : undefined;
  }
  return undefined;
}

function isExported(node: ts.Node): boolean {
  if (ts.isExportAssignment(node) || ts.isExportDeclaration(node)) return true;
  return ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) === true;
}

function isNonConstCast(node: ts.Node): boolean {
  if (!ts.isAsExpression(node) && !ts.isTypeAssertionExpression(node)) return false;
  const type = node.type;
  return !ts.isTypeReferenceNode(type) || type.typeName.getText() !== 'const';
}

function countExportDocs(source: ts.SourceFile): number {
  return source.statements.filter((node) =>
    isExported(node) && !ts.getJSDocCommentsAndTags(node).some(ts.isJSDoc),
  ).length;
}

function forbiddenDirectives(source: ts.SourceFile): number {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, source.languageVariant,
    source.text);
  let matches = 0;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia &&
      /^\/\/\s*@ts-(?:ignore|nocheck)\b/.test(scanner.getTokenText())) matches += 1;
  }
  return matches;
}

/** Counts actual TypeScript nodes and attached JSDoc without scanning prose for casts. */
export function inspectSourceQuality(file: string, content: string) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const banned = file.startsWith('src/domain/') ? DOMAIN_BANNED
    : file.startsWith('src/') ? CLIENT_BANNED : [];
  let escapes = forbiddenDirectives(source);
  let casts = 0;
  let emptyCatches = 0;
  const imports = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) escapes += 1;
    if (isNonConstCast(node)) casts += 1;
    if (ts.isCatchClause(node) && node.block.statements.length === 0) emptyCatches += 1;
    const spec = getImport(node);
    if (spec !== undefined && banned.some((base) =>
      spec === base || spec.startsWith(base.endsWith(':') ? base : `${base}/`),
    )) imports.add(spec);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { escapes, casts, emptyCatches, imports, missingDocs: countExportDocs(source) };
}

/** Scores syntax-based quality findings and preserves the evaluator's type-escape cap. */
export function scoreSourceQuality(file: string, content: string): {
  readonly deductions: DeductionItem[];
  readonly capped: boolean;
  readonly missingDocs: number;
} {
  const quality = inspectSourceQuality(file, content);
  const production = /^(?:src|server|api)\//.test(file);
  const capped = production && quality.escapes > 0;
  const deductions = [...quality.imports].map((spec) =>
    makeDeduction('codeQuality', 1.5, `Boundary violation: ${spec}`, file),
  );
  if (capped) deductions.push(
    makeDeduction('codeQuality', quality.escapes * 2, 'Explicit type escapes or TS directives', file),
  );
  if (production && quality.casts > 0) deductions.push(
    makeDeduction('codeQuality', quality.casts * 0.35, 'Non-const type assertions', file),
  );
  if (production && quality.emptyCatches > 0) deductions.push(
    makeDeduction('codeQuality', quality.emptyCatches * 0.5, 'Empty catch blocks', file),
  );
  return { deductions, capped, missingDocs: quality.missingDocs };
}
