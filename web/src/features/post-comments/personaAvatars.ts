import xiaorou from './avatars/xiaorou.png';
import momo from './avatars/momo.png';
import xiaoqing from './avatars/xiaoqing.png';
import sunLingting from './avatars/sun-lingting.png';

const personaAvatars = new Map([
  ['neighbor', xiaorou],
  ['reader', momo],
  ['friend', xiaoqing],
  ['traveler', sunLingting],
]);

export function getPersonaAvatar(personaId: string | null | undefined): string | undefined {
  return personaId ? personaAvatars.get(personaId) : undefined;
}
