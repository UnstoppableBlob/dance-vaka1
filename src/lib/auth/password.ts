import "server-only";

import argon2 from "argon2";

const passwordHashOptions = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
};

export const dummyPasswordHash =
  "$argon2id$v=19$m=65536,t=3,p=1$vw4za+ai6oFqtYeU1KzFWg$ObrXA4oJ+Q8Q9m0gPPVm/CiBZp4+80nZub8SK1cZbNk";

export function hashPassword(password: string) {
  return argon2.hash(password, passwordHashOptions);
}

export async function verifyPassword(hash: string, password: string) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
