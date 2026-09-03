export type TeamIconOption = {
  /** Stable lucide icon name (kebab-case) persisted for the project. */
  readonly name: string;
  /** Korean label used for picker search and tooltips. */
  readonly ko: string;
  /** English label used for picker search and tooltips. */
  readonly en: string;
};

/** Frequently used lucide icons offered as predefined project icons. */
export const teamIcons: readonly TeamIconOption[] = [
  { name: "folder", ko: "폴더", en: "folder" },
  { name: "folder-git-2", ko: "Git 폴더", en: "git folder" },
  { name: "briefcase", ko: "업무", en: "work" },
  { name: "rocket", ko: "로켓", en: "rocket" },
  { name: "lightbulb", ko: "아이디어", en: "idea" },
  { name: "puzzle", ko: "퍼즐", en: "puzzle" },
  { name: "sparkles", ko: "반짝임", en: "sparkles" },
  { name: "zap", ko: "번개", en: "zap" },
  { name: "star", ko: "별", en: "star" },
  { name: "heart", ko: "하트", en: "heart" },
  { name: "thumbs-up", ko: "좋아요", en: "thumbs up" },
  { name: "smile", ko: "미소", en: "smile" },
  { name: "target", ko: "목표", en: "target" },
  { name: "trophy", ko: "트로피", en: "trophy" },
  { name: "award", ko: "메달", en: "medal" },
  { name: "crown", ko: "왕관", en: "crown" },
  { name: "gem", ko: "보석", en: "gem" },
  { name: "flag", ko: "깃발", en: "flag" },
  { name: "bookmark", ko: "북마크", en: "bookmark" },
  { name: "compass", ko: "나침반", en: "compass" },
  { name: "map", ko: "지도", en: "map" },
  { name: "map-pin", ko: "위치", en: "location" },
  { name: "globe", ko: "지구", en: "globe" },
  { name: "plane", ko: "비행기", en: "plane" },
  { name: "car", ko: "자동차", en: "car" },
  { name: "train", ko: "기차", en: "train" },
  { name: "truck", ko: "트럭", en: "truck" },
  { name: "anchor", ko: "닻", en: "anchor" },
  { name: "mountain", ko: "산", en: "mountain" },
  { name: "home", ko: "홈", en: "home" },
  { name: "building-2", ko: "빌딩", en: "building" },
  { name: "landmark", ko: "공공기관", en: "landmark" },
  { name: "factory", ko: "공장", en: "factory" },
  { name: "school", ko: "학교", en: "school" },
  { name: "graduation-cap", ko: "학위", en: "graduation" },
  { name: "book-open", ko: "책", en: "book" },
  { name: "newspaper", ko: "뉴스", en: "news" },
  { name: "file-text", ko: "문서", en: "document" },
  { name: "code-2", ko: "코드", en: "code" },
  { name: "terminal", ko: "터미널", en: "terminal" },
  { name: "git-branch", ko: "브랜치", en: "branch" },
  { name: "database", ko: "데이터베이스", en: "database" },
  { name: "server", ko: "서버", en: "server" },
  { name: "cpu", ko: "칩", en: "chip" },
  { name: "cloud", ko: "클라우드", en: "cloud" },
  { name: "layers", ko: "레이어", en: "layers" },
  { name: "box", ko: "박스", en: "box" },
  { name: "package", ko: "패키지", en: "package" },
  { name: "square-kanban", ko: "칸반", en: "kanban" },
  { name: "settings", ko: "설정", en: "settings" },
  { name: "shield-check", ko: "보안", en: "security" },
  { name: "lock", ko: "잠금", en: "lock" },
  { name: "key", ko: "키", en: "key" },
  { name: "bug", ko: "버그", en: "bug" },
  { name: "wrench", ko: "공구", en: "wrench" },
  { name: "hammer", ko: "망치", en: "hammer" },
  { name: "flask-conical", ko: "실험실", en: "lab" },
  { name: "microscope", ko: "현미경", en: "microscope" },
  { name: "atom", ko: "과학", en: "science" },
  { name: "dna", ko: "DNA", en: "dna" },
  { name: "chart-line", ko: "차트", en: "chart" },
  { name: "chart-column", ko: "막대 그래프", en: "bar chart" },
  { name: "trending-up", ko: "상승", en: "trending" },
  { name: "pie-chart", ko: "파이 차트", en: "pie chart" },
  { name: "coins", ko: "코인", en: "coins" },
  { name: "wallet", ko: "지갑", en: "wallet" },
  { name: "calendar", ko: "캘린더", en: "calendar" },
  { name: "clock", ko: "시계", en: "clock" },
  { name: "hourglass", ko: "모래시계", en: "hourglass" },
  { name: "bell", ko: "알림", en: "notification" },
  { name: "megaphone", ko: "공지", en: "announcement" },
  { name: "message-circle", ko: "채팅", en: "chat" },
  { name: "mail", ko: "메일", en: "mail" },
  { name: "send", ko: "보내기", en: "send" },
  { name: "users", ko: "팀", en: "team" },
  { name: "leaf", ko: "환경", en: "leaf" },
  { name: "tree-pine", ko: "나무", en: "tree" },
  { name: "flower-2", ko: "꽃", en: "flower" },
  { name: "sun", ko: "해", en: "sun" },
  { name: "moon", ko: "달", en: "moon" },
  { name: "coffee", ko: "커피", en: "coffee" },
  { name: "utensils", ko: "식사", en: "food" },
  { name: "music", ko: "음악", en: "music" },
  { name: "headphones", ko: "헤드셋", en: "headphones" },
  { name: "mic", ko: "마이크", en: "microphone" },
  { name: "camera", ko: "카메라", en: "camera" },
  { name: "film", ko: "영상", en: "film" },
  { name: "gamepad-2", ko: "게임", en: "game" },
  { name: "palette", ko: "디자인", en: "design" },
  { name: "brush", ko: "브러시", en: "brush" },
  { name: "pen-tool", ko: "펜", en: "pen" },
  { name: "scissors", ko: "가위", en: "scissors" },
  { name: "bird", ko: "새", en: "bird" },
];

export const teamIconNames: ReadonlySet<string> = new Set(
  teamIcons.map((icon) => icon.name),
);

export function isTeamIconName(value: string): boolean {
  return teamIconNames.has(value);
}

/** Preset swatch colors offered in the icon picker. */
export const teamIconColors: readonly string[] = [
  "#71717a",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#9333ea",
  "#ec4899",
];

/** Lowercase #rrggbb only — the D1 column check enforces the same shape. */
export function isTeamIconColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/u.test(value);
}
