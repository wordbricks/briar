import {
  teamAgentAvatarAccept,
  teamAgentAvatarFromFile,
} from "./team-agent-avatar";

export const workerLogoAccept = teamAgentAvatarAccept;
export const workerLogoFromFile = teamAgentAvatarFromFile;

export {
  isWorkerEmoji,
  isWorkerLogoDataUrl,
  maxWorkerEmojiLength,
  maxWorkerLogoDataUrlLength,
} from "./worker-icon-validation";
