import { hash, verify } from "@node-rs/argon2";

const ARGON2_OPTS = {
  // argon2id defaults from OWASP cheat sheet (m=19 MiB, t=2, p=1).
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$ZHVtbXlzYWx0ZHVtbXlzYWx0$" +
  "ZHVtbXloYXNoZHVtbXloYXNoZHVtbXloYXNoZHVtbXloYXNoZHVtbXk";

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTS);
}

export async function verifyPassword(
  storedHash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}

// Constant-time-ish stand-in for the "unknown email" path so login timing
// doesn't leak account existence.
export async function dummyVerify(plain: string): Promise<boolean> {
  return verifyPassword(DUMMY_HASH, plain);
}
