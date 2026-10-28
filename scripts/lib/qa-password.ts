import { randomInt } from 'node:crypto';

export const QA_PASSWORD_LENGTH = 24;

const LOWERCASE_CHARACTERS = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGIT_CHARACTERS = '0123456789';
// Supabase rejects passwords without symbols; quotes, bars and spaces break the manual login.
const SYMBOL_CHARACTERS = '!#$%&*+-=?@^';

const REQUIRED_CHARACTER_GROUPS = [
  LOWERCASE_CHARACTERS,
  UPPERCASE_CHARACTERS,
  DIGIT_CHARACTERS,
  SYMBOL_CHARACTERS,
] as const;

const ALL_CHARACTERS = REQUIRED_CHARACTER_GROUPS.join('');

const pickCharacter = (characters: string): string =>
  characters[randomInt(characters.length)];

const shuffleWithCrypto = (characters: readonly string[]): string[] => {
  const shuffled = [...characters];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const displacedCharacter = shuffled[swapIndex];
    shuffled[swapIndex] = shuffled[index];
    shuffled[index] = displacedCharacter;
  }
  return shuffled;
};

export function generateQaPassword(): string {
  const requiredCharacters = REQUIRED_CHARACTER_GROUPS.map((group) =>
    pickCharacter(group),
  );
  const fillerCharacters = Array.from(
    { length: QA_PASSWORD_LENGTH - requiredCharacters.length },
    () => pickCharacter(ALL_CHARACTERS),
  );

  return shuffleWithCrypto([...requiredCharacters, ...fillerCharacters]).join(
    '',
  );
}
