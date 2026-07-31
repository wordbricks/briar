import {
  projectAgentAvatarAccept,
  projectAgentAvatarFromFile,
} from "./project-agent-avatar";

export const workerLogoAccept = projectAgentAvatarAccept;
export const workerLogoFromFile = projectAgentAvatarFromFile;

export {
  isWorkerEmoji,
  isWorkerLogoDataUrl,
  maxWorkerEmojiLength,
  maxWorkerLogoDataUrlLength,
} from "./worker-icon-validation";
