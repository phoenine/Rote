import xiaorou from './avatars/xiaorou.webp';
import momo from './avatars/momo.webp';
import xiaoqing from './avatars/xiaoqing.webp';
import sunLingting from './avatars/sun-lingting.webp';

const personaAvatars = new Map([
  ['neighbor', xiaorou],
  ['reader', momo],
  ['friend', xiaoqing],
  ['traveler', sunLingting],
]);

export function getPersonaAvatar(personaId: string | null | undefined): string | undefined {
  return personaId ? personaAvatars.get(personaId) : undefined;
}
