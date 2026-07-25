// 프로젝트 목록은 계정 상태이고, 저장소 연결은 기기 상태입니다.
// 로컬 연결 여부를 모르는 동안(웹·모바일·조회 실패)에는 연결 안내를 띄우지 않습니다.
export function isProjectConnectedLocally(
  connectedProjectIds: string[] | null,
  projectId: string | null,
) {
  if (!connectedProjectIds || !projectId) return true;
  return connectedProjectIds.includes(projectId);
}

export function withConnectedProject(
  connectedProjectIds: string[] | null,
  projectId: string,
) {
  if (!connectedProjectIds) return connectedProjectIds;
  return connectedProjectIds.includes(projectId)
    ? connectedProjectIds
    : [...connectedProjectIds, projectId];
}

export function withoutConnectedProject(
  connectedProjectIds: string[] | null,
  projectId: string,
) {
  if (!connectedProjectIds) return connectedProjectIds;
  return connectedProjectIds.filter((id) => id !== projectId);
}
