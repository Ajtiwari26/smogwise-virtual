/**
 * Precomputed salted scrypt evaluator account directory.
 */

import type { LanguageCode, PersonaType } from '../../src/domain/types.js';

/** Public user attributes safe to return to clients and encode in session tokens. */
export interface PublicUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly personaId: PersonaType;
  readonly defaultLang: LanguageCode;
  readonly defaultCityId: string;
}

/** Internal evaluator account record with salted scrypt password digest. */
export interface StoredAuthAccount extends PublicUser {
  readonly salt: string;
  readonly passwordHash: string;
}

/** Constant-time fallback scrypt material used when an email is not found. */
export const DUMMY_SCRYPT_RECORD: Readonly<{ salt: string; passwordHash: string }> = {
  salt: '8f4b2c19d7e3056a1c8e4f92b0d37a65',
  passwordHash:
    'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0',
};

const STORED_ACCOUNTS: readonly StoredAuthAccount[] = [
  {
    id: 'eval_family',
    email: 'family.eval@smogwise.in',
    name: 'Delhi Family Evaluator',
    personaId: 'young_family',
    defaultLang: 'en',
    defaultCityId: 'delhi_anand_vihar',
    salt: '7d73ac2b16db331c9f5c2dd1a2625965',
    passwordHash:
      'b69994b1dcc9936aeaf3a80131509a30c8a441f0ab6328bf9bc4e0637c35c9bc37436ab5271b70c2067404c215c9035a61a9e126fa44500bbcd935de76d8183e',
  },
  {
    id: 'eval_senior',
    email: 'senior.eval@smogwise.in',
    name: 'Lucknow Senior Evaluator',
    personaId: 'sensitive_household',
    defaultLang: 'hi',
    defaultCityId: 'lucknow_gomtinagar',
    salt: '171be61863b961e3a3ffc6fc15215773',
    passwordHash:
      '846a4a9f64ff972c50346bc93302df973139afeed76d7ff535bf694c99dc662cc5efabe100723bbca4deb95d96ed657febc0a7e051b1353bd66edf7a94199089',
  },
  {
    id: 'eval_rwa',
    email: 'rwa.eval@smogwise.in',
    name: 'Gurugram RWA Coordinator',
    personaId: 'rwa_coordinator',
    defaultLang: 'en',
    defaultCityId: 'gurugram_dlf',
    salt: '0b8e73914260e651520cb77dd147781d',
    passwordHash:
      'acc27c26cdb2c581ee1f7c171ab680e205daa4b82e2a44aab188212b6b73eab29f7bfbd340863aafc01b4edb5cad785be0eeaf1e5253665527889810153b2697',
  },
  {
    id: 'eval_commuter',
    email: 'commuter.eval@smogwise.in',
    name: 'Delhi Office Commuter',
    personaId: 'office_commuter',
    defaultLang: 'en',
    defaultCityId: 'delhi_anand_vihar',
    salt: '4ec5546d78c5405e41176986f2cfae98',
    passwordHash:
      '9341cffbddd517bf06f5226335b027628451157521e11239793f1852064cd3c58fb68743df90a0f1fa4c7f7196a81052c3e4b747a67a7f8d61014057a64cb9f2',
  },
  {
    id: 'eval_student',
    email: 'student.eval@smogwise.in',
    name: 'Kanpur Outdoor Student',
    personaId: 'outdoor_student',
    defaultLang: 'en',
    defaultCityId: 'kanpur_nehru_nagar',
    salt: '71c5ae0b04e945174d53d663bb4285e5',
    passwordHash:
      '87a05cd6c98b584fbbcdbed49cf1c8a9fd103ce77217c683d702e1d6f22f548bfdd7b92586ab0499329230dca1d6c51fd746e6eb534a91b46be8e90083ceac72',
  },
];

const ACCOUNTS_BY_EMAIL = new Map<string, StoredAuthAccount>(
  STORED_ACCOUNTS.map((account) => [account.email.toLowerCase(), account]),
);

/**
 * Looks up a stored account by normalized email address.
 */
export function findAccountByEmail(email: string): StoredAuthAccount | undefined {
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0) {
    return undefined;
  }
  return ACCOUNTS_BY_EMAIL.get(normalized);
}

/**
 * Strips sensitive scrypt salt and digest fields from a stored account.
 */
export function toPublicUser(account: StoredAuthAccount): PublicUser {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    personaId: account.personaId,
    defaultLang: account.defaultLang,
    defaultCityId: account.defaultCityId,
  };
}
