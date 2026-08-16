import { type Locale, copy, localizedPath } from "../i18n";
import { Arrow, SiteFooter, SiteHeader } from "../site-chrome";
import { GITHUB_RELEASES_URL } from "../site-links";

export const changelogCopy = {
  ko: {
    metadata: {
      title: "Briar 변경 기록 — 새로운 기능과 개선 사항",
      description:
        "Briar의 최신 데스크톱, 채널, 모바일, 에이전트 워크플로 업데이트를 확인하세요.",
    },
    eyebrow: "PRODUCT UPDATES",
    title: "Briar 변경 기록",
    description:
      "사람과 에이전트가 더 선명하게 협업할 수 있도록 바뀐 기능과 개선 사항을 기록합니다.",
    current: "현재 안정 버전",
    latest: "최신",
    released: "출시",
    openApp: "Briar 열기",
    allReleases: "전체 릴리즈 보기",
    releaseNotes: "GitHub 릴리즈 열기",
    home: "홈",
    backTop: "맨 위로 ↑",
    entries: [
      {
        version: "1.2.128",
        date: "2026년 8월 16일",
        title: "보낸 메시지를 더 자연스럽게 이어 보여줍니다",
        summary:
          "메시지를 보내자마자 대화에 표시하면서도 불필요한 전송 상태 문구 없이 실제 대화처럼 자연스럽게 읽히도록 다듬었습니다.",
        items: [
          "채널·이슈·Companion 대화에서 낙관적으로 표시되는 내 메시지의 ‘전송 중’ 문구를 제거하고, 서버 확인 전후에도 작성자·시간·내용의 배치가 흔들리지 않게 유지합니다.",
        ],
      },
      {
        version: "1.2.127",
        date: "2026년 8월 16일",
        title: "실시간 대화와 전송 경험을 더 즉각적으로 연결합니다",
        summary:
          "채널과 이슈 대화에서 보낸 메시지를 바로 확인하고, 에이전트 활동과 모바일 탐색 상태를 더 안정적으로 이어갈 수 있게 했습니다.",
        items: [
          "이슈 대화와 채널 에이전트의 진행 활동을 실시간으로 스트리밍하고, 작업이 끝나거나 연결이 끊길 때도 상태를 자연스럽게 정리합니다.",
          "채널·이슈 메시지를 전송 직후 화면에 표시하고 클라이언트 메시지 ID로 중복을 막아, 답글·첨부 파일과 서버 동기화가 더 빠르게 이어집니다.",
          "긴 채널 메시지를 모바일에서 길게 눌러 선택·복사할 수 있고, 대화가 아래에 있지 않을 때 최신 메시지로 돌아가는 버튼을 제공합니다.",
          "모바일 채널과 이슈 대화의 캐시·재진입·로딩 상태를 다듬어 오래된 답글이 남거나 최신 메시지가 늦게 나타나는 문제를 줄였습니다.",
          "실행 세션에 실제 Worker 이름을 표시해 UUID 대신 현재 작업을 처리하는 환경을 쉽게 식별할 수 있습니다.",
        ],
      },
      {
        version: "1.2.126",
        date: "2026년 8월 15일",
        title: "첫 실행과 대화 결과를 더 빠르고 정확하게 연결합니다",
        summary:
          "역할에 맞는 온보딩부터 구조화된 채널 메시지, 실시간 이슈 대화와 에이전트 응답까지 더 분명하고 안정적으로 다듬었습니다.",
        items: [
          "공통 소개와 Google 로그인 뒤 초대 사용자·개발자·협업자 경로를 나누고, 프로젝트 워크플로 생성 단계와 경과 시간·마무리 상태를 명확하게 보여줍니다.",
          "Slack Block Kit 웹훅 메시지의 텍스트·섹션·필드·구분선·컨텍스트·이미지 블록을 채널에서 읽기 쉽게 렌더링하고, 원본 블록을 데이터베이스에 보존합니다.",
          "이슈 전환 시 이전 결과 스크린샷이 남지 않게 하고, 열린 이슈 대화를 실시간 동기화하면서 현재 보고 있는 답글의 중복 알림을 억제합니다.",
          "이슈 답변과 채널 에이전트 대기 상태를 픽셀 그리드 로더·진행 문구·경과 시간으로 표시해 오래 걸리는 작업의 상태를 더 쉽게 파악할 수 있습니다.",
          "승인 요청의 구조화된 응답과 채널 멘션 UUID를 안정적으로 정규화하고, 네이티브 iOS에서 첫 채널 메시지 로드와 전송 직후 초안 초기화를 개선했습니다.",
        ],
      },
      {
        version: "1.2.125",
        date: "2026년 8월 15일",
        title: "Inbox 답글과 좁은 이슈 화면을 더 자연스럽게 연결합니다",
        summary:
          "답글 작성자를 한눈에 알아보고, 좁은 이슈 화면에서도 설명·상태·대화를 탭으로 편하게 오갈 수 있도록 다듬었습니다.",
        items: [
          "이슈 대화 답글 알림에 일반 아이콘 대신 실제 작성자의 아바타를 데스크탑·Android·네이티브 iOS에서 표시하고, 이미지가 없거나 실패하면 이름 첫 글자로 안전하게 대체합니다.",
          "이슈 상세 영역이 960px보다 좁아지면 대화 패널을 별도 메시지 탭으로 옮겨 설명·활동·상태와 같은 폭을 사용하며, 다시 넓어지면 기존 분할 패널로 자연스럽게 돌아갑니다.",
          "랜딩페이지의 운영 의존성을 갱신해 알려진 프로덕션 취약점을 제거하면서 기존 Cloudflare Worker 빌드와 화면 동작을 유지했습니다.",
        ],
      },
      {
        version: "1.2.124",
        date: "2026년 8월 15일",
        title: "채널 대화와 에이전트 진행 상황을 더 빠르게 연결합니다",
        summary:
          "채널을 빠르게 전환하고 에이전트 활동을 실시간으로 확인하며, Inbox와 백그라운드 동기화의 응답성을 높였습니다.",
        items: [
          "채널 에이전트의 명령·파일·검색·도구 활동을 답글 단위로 실시간 표시하고, 재연결 뒤에도 활성 작업 상태를 복구하며 민감한 값은 전송 전에 가립니다.",
          "데스크탑 채널을 최신 메시지 20개와 캐시로 즉시 열고, 위로 스크롤해 이전 기록을 불러오며 긴 대화는 가상화해 빠른 연속 전환에도 오래된 결과가 섞이지 않게 합니다.",
          "채널 답글 알림에서 연 스레드를 유지하고, 에이전트 제공자를 접근 가능한 아이콘으로 표시하며, 긴 이슈 설명은 남은 패널 높이를 채운 채 내부에서 스크롤합니다.",
          "채널 답글은 가능한 경우 현재 조직의 로컬 Worker를 우선하고 실패하면 다른 Worker로 안전하게 전환합니다.",
          "Inbox 알림 대상과 GitHub 병합 확인 후보를 인덱싱하고, 유휴 프로젝트 동기화를 조직 단위 실시간 갱신으로 묶어 불필요한 요청과 데이터베이스 작업을 줄였습니다.",
        ],
      },
      {
        version: "1.2.123",
        date: "2026년 8월 14일",
        title: "이미지 확인과 Inbox·로딩 경험을 더 선명하게 다듬습니다",
        summary:
          "이미지를 크게 보고 내려받을 수 있게 하고, Inbox 발신자와 긴 로딩 상태를 더 분명하게 보여주며 새 데모 영상을 반영했습니다.",
        items: [
          "채널 이미지와 이슈 본문·첨부 파일·실행 증빙 스크린샷을 누르면 큰 라이트박스로 열고, 원래 파일 이름을 유지한 채 바로 내려받을 수 있습니다.",
          "Inbox의 채널 알림에 임의의 프로젝트 아이콘 대신 실제 보낸 사람의 아바타를 데스크탑·Android·네이티브 iOS에서 표시하고, 이미지가 없거나 불러오지 못하면 이름 첫 글자로 안전하게 대체합니다.",
          "Inbox 상세, 이슈 목록, 실행 증빙과 초대 확인처럼 오래 걸릴 수 있는 화면의 원형 스피너를 3×3 픽셀 웨이브와 진행 시간으로 바꾸고, 모션 감소와 스크린 리더 환경에서도 안정적으로 안내합니다.",
          "랜딩페이지의 이슈 시작부터 완료까지 데모 영상을 최신 제품 흐름을 담은 새 녹화본으로 교체했습니다.",
        ],
      },
      {
        version: "1.2.122",
        date: "2026년 8월 14일",
        title: "채널 실행 상태와 조직·Inbox 탐색을 더 분명하게 다듬습니다",
        summary:
          "실행 가능한 Worker가 없을 때 즉시 알리고, 조직과 Inbox 탐색을 간결하게 만들며 Antigravity 브랜딩을 정돈했습니다.",
        items: [
          "채널에서 에이전트를 멘션하면 온라인·준비·작업 수락 상태와 제공자·모델·Effort 호환성을 먼저 확인하고, 실행할 수 있는 Worker가 없으면 데스크탑과 Companion에 이해하기 쉬운 오류를 즉시 표시합니다.",
          "사이드바에서 조직 이름을 누르면 중간 단계 없이 조직 목록과 현재 선택 상태, 새 조직 추가 동작을 바로 보여줘 조직 전환을 더 빠르게 처리합니다.",
          "Inbox 분류 필터를 개수 배지가 붙은 접근 가능한 아이콘 버튼으로 정리해 프로젝트 선택기 옆에서도 이름이 잘리지 않고 필요한 알림을 빠르게 좁힐 수 있습니다.",
          "Antigravity가 앱 전체의 에이전트 선택기와 상태 화면에서 번들된 제공자 이미지로 일관되게 표시됩니다.",
        ],
      },
      {
        version: "1.2.121",
        date: "2026년 8월 14일",
        title: "Antigravity를 연결하고 워크플로 생성을 더 깔끔하게 보여줍니다",
        summary:
          "Google Antigravity를 새로운 에이전트 제공자로 추가하고, 워크플로 생성 중 내부 데이터 대신 이해하기 쉬운 진행 상태를 표시합니다.",
        items: [
          "초기 설정과 앱 설정에서 Google Antigravity CLI를 설치·로그인·활성화하고, 실제 지원 모델과 Effort를 불러와 이슈·프로젝트·조직 에이전트와 Worker 작업에 선택할 수 있습니다.",
          "Antigravity 실행기를 데스크탑과 Briar CLI에 함께 번들링해 새 작업과 이어지는 대화, 도구 활동, 첨부 파일, 승인·샌드박스·네트워크 정책을 기존 제공자와 같은 실행 흐름으로 처리합니다.",
          "Antigravity의 인증·상태·사용량 소진을 감지하고 실행 모델과 토큰·예상 비용을 Google 가격 정보에 연결해 설정과 사용량 화면에서 확인할 수 있습니다.",
          "워크플로 생성과 도구 분석의 마지막 단계에서 completion·execution·stages 같은 내부 JSON을 노출하지 않고, 분석 결과를 정리하고 있다는 로컬라이즈된 진행 문구를 표시합니다.",
        ],
      },
      {
        version: "1.2.120",
        date: "2026년 8월 14일",
        title: "실시간 대화와 에이전트 실행을 더 정확하게 연결합니다",
        summary:
          "제공자가 실제 지원하는 모델로 작업을 배정하고, 채널 동기화·결과 확인·모바일 기록 탐색과 Worker 실행 안정성을 개선했습니다.",
        items: [
          "Codex·Claude·Grok·OpenCode CLI에서 사용 가능한 모델과 모델별 Effort를 동적으로 감지해 Worker가 보고하고, 데스크탑·모바일·iOS에서 같은 선택지를 사용하며 명시적 배정 전에 실제 지원 여부를 검증합니다.",
          "채널·프로젝트 대화·Inbox가 조직별 WebSocket 하나를 공유하고, Inbox 변경을 즉시 반영하면서 트랜잭션 outbox와 60초 fallback으로 연결 누락을 복구합니다.",
          "채널 Inbox 이벤트를 메시지 동기화 신호로 사용해 알림보다 답글 표시가 늦어지지 않게 하고, 사용자가 현재 보고 있는 채널의 알림만 억제하면서 로딩 중 도착한 갱신도 이어서 반영합니다.",
          "완료 결과와 검토 대기 중인 부분 결과 리포트 안에 최신 통과 리비전의 증빙 스크린샷을 바로 표시해 별도 탭으로 이동하지 않고 결과를 확인할 수 있습니다.",
          "채널 멘션 목록에서 사람과 마찬가지로 에이전트의 설정된 아바타를 보여주고, 이미지가 없는 에이전트에는 일관된 Bot 대체 아이콘을 표시합니다.",
          "같은 이슈 실행을 중복 claim하는 Worker 요청을 직렬화하고 실행 시도별 세션 디렉터리를 분리해, 재작업 중 이전 정리가 새 실행을 지우거나 오래된 제공자 턴이 계속되는 경합을 막습니다.",
          "iOS와 Android 채널은 최신 루트 메시지 20개부터 열고 위로 스크롤할 때 이전 기록을 추가하며, 오래된 알림을 직접 열어도 현재 읽던 위치를 보존합니다.",
        ],
      },
      {
        version: "1.2.119",
        date: "2026년 8월 14일",
        title: "대화 화면과 에이전트 설정을 더 선명하게 다듬습니다",
        summary:
          "이슈와 채널 대화를 더 자연스럽게 읽고 작성하며, Inbox·에이전트 설정·실행 비용 표시를 안정적으로 개선했습니다.",
        items: [
          "iOS 이슈 대화를 날짜 구분선, 아바타, 작성자와 시간이 있는 채널형 타임라인으로 바꾸고, 키보드가 열려도 바로 쓸 수 있는 하단 고정 작성창과 Markdown·답글·멘션·이미지 첨부를 유지합니다.",
          "iOS와 Android 공용 채널 화면의 헤더를 참여 정보가 보이는 캡슐 스타일로 정리하고, 첨부·입력·전송을 하나의 연속형 작성창에 배치하며 투명도 감소와 고대비 환경도 지원합니다.",
          "Inbox에서 채널 스레드 답글을 열어도 사이드바와 헤더, 작성창이 화면 안에 남고 요청한 답글만 상세 패널의 대화 스크롤 영역 중앙으로 이동합니다.",
          "프로젝트 에이전트는 스킬 없이도 만들고 마지막 스킬까지 삭제할 수 있으며, 실행이 필요한 시점에는 스킬 추가 안내를 표시하고 긴 책임 설명은 여섯 줄로 정돈합니다.",
          "기본 모델로 실행한 작업도 제공자가 실제 사용한 모델과 예상 비용을 표시하고, Grok 빌드 변형은 호환되는 기본 모델 가격에 연결합니다.",
          "에이전트 생성 모달의 제공자·모델·Effort 메뉴 위치, 채널 목록 마커와 멘션 간격을 바로잡고, Inbox 알림 아이콘에 프로젝트 배지를 추가했습니다.",
        ],
      },
      {
        version: "1.2.118",
        date: "2026년 8월 13일",
        title: "에이전트 이름과 작업 화면을 더 자연스럽게 연결합니다",
        summary:
          "채널 멘션을 실제 에이전트 이름으로 통일하고, 이슈 탐색·Inbox·모델 선택·사용량 집계를 더 정확하게 다듬었습니다.",
        items: [
          "채널에서 별도 핸들 대신 공백과 비라틴 문자를 포함한 정확한 에이전트 이름으로 멘션하며, 구조화된 에이전트 ID로 라우팅하고 중복 이름은 잘못된 프로필에 연결하지 않습니다.",
          "⌘[와 ⌘]이 이슈 목록과 방문한 이슈 상세를 순서대로 오가고, Inbox 오른쪽 이슈 패널의 긴 결과와 대화는 패널 안에서 정상적으로 스크롤됩니다.",
          "Process now 등 모달 안의 모델 메뉴가 모달 경계 안에서 열려 긴 OpenCode 모델 목록을 검색하고 스크롤할 수 있습니다.",
          "열린 채널 스레드에서 에이전트 답변 상태를 작성창 위에 표시하고, 다른 메시지의 진행 상태는 기존 위치에 유지합니다.",
          "Codex의 한 턴에 포함된 모든 모델 호출 사용량을 누적 스냅샷에서 계산해 재개된 대화를 중복 집계하지 않으면서 토큰과 예상 비용을 정확히 기록합니다.",
          "네이티브 iOS Agents 화면에 프로젝트·계정 도구 모음을 연결하고 최신 TestFlight 빌드의 모바일 릴리즈 검증을 완료했습니다.",
        ],
      },
      {
        version: "1.2.117",
        date: "2026년 8월 13일",
        title: "채널과 Inbox를 더 읽기 쉽고 정확하게 연결합니다",
        summary:
          "채널 메시지 표현과 Inbox 이동을 다듬고, Developer 에이전트의 역할과 긴 작업 기록·제공자 사용량 처리를 더 명확하고 안정적으로 만듭니다.",
        items: [
          "프로젝트 사이드바의 중복 Home 항목을 없애고 프로젝트 이름 자체가 홈을 열고 현재 위치를 표시하도록 단순화했습니다.",
          "채널 메시지에 설정된 에이전트 아바타를 데스크탑·모바일·iOS에서 표시하고, 멘션 간격과 링크·인라인 코드·코드 블록·목록·인용·표의 Markdown 가독성을 개선했습니다.",
          "데스크탑 Inbox의 채널 알림은 오른쪽 상세 패널에서 원문 또는 정확한 스레드를 열고, 모바일과 iOS의 이슈 대화 알림은 올바른 대화 탭으로 이동하면서 메시지 식별자와 읽음 상태를 보존합니다.",
          "작업 기록 요청 전체 크기를 정확히 측정하고 HTTP 413 응답 시 배치를 순서대로 나눠 재전송하며, 선택적 기록 전송 실패가 에이전트 실행 자체를 실패시키지 않도록 했습니다.",
          "OpenCode 무료 사용량 소진을 메타데이터가 부족한 경우에도 감지하고, Worker가 제공자의 사용량 소진 상태와 최대 사용률을 받아 등록 차단 여부를 정확히 판단합니다.",
          "새 프로젝트의 기본 Developer 에이전트가 개발 계획에 그치지 않고 구현·검증·전달까지 직접 소유하도록 책임 문구를 갱신하며, 기존 기본값을 사용하던 에이전트에도 같은 변경을 적용합니다.",
        ],
      },
      {
        version: "1.2.116",
        date: "2026년 8월 13일",
        title: "긴 에이전트 작업 기록을 더 안정적으로 보존합니다",
        summary:
          "모든 제공자의 원본 이벤트와 화면에 보이는 작업 기록을 분리해, 출력이 길어져도 마지막 답변과 완료 상태를 놓치지 않습니다.",
        items: [
          "Codex·Claude·Grok·OpenCode의 원본 이벤트를 압축된 변경 불가 R2 세그먼트로 보존하고, 메시지와 활동만 작은 D1 작업 기록으로 투영해 대량 출력이 세션 한도를 소진하지 않게 합니다.",
          "업로드 실패를 순서대로 최대 세 번 재시도하고 같은 세그먼트 재전송을 안전하게 처리하며, 끝내 실패하면 배치를 버리지 않고 호출자에게 알립니다.",
          "제공자가 완료 이벤트 없이 종료해도 남아 있는 작성 중 항목을 중단 상태로 닫아, 끝난 세션에 로딩 표시가 계속 남지 않습니다.",
          "권한이 있는 사용자는 원본 세그먼트 목록과 압축 파일을 내려받을 수 있습니다. 이번 저장 방식 전환으로 배포 전 작업 기록은 초기화되고 기존 원본 아카이브는 비동기 삭제 대기열로 이동합니다.",
        ],
      },
      {
        version: "1.2.115",
        date: "2026년 8월 13일",
        title: "작업 보드와 대화, 모델 선택을 더 선명하게 다듬었습니다",
        summary:
          "읽지 않은 대화와 Inbox를 빠르게 살피고, 칸반 열·모델 선택·에이전트 이미지 답변과 오류 진단을 더 정확하게 다룹니다.",
        items: [
          "데스크탑·모바일·iOS에서 읽지 않은 채널 이름을 굵게 표시하고 읽음 상태를 동기화하며, 이슈 생성자와 대화 참여자, 멘션된 조직 구성원을 자동으로 구독합니다.",
          "데스크탑 Inbox를 크기 조절이 가능한 목록·상세 분할 화면으로 바꾸고, 필요 없는 칸반 열은 오른쪽 숨김 목록으로 옮겼다가 다시 복원할 수 있습니다.",
          "이슈·프로젝트·조직·에이전트 설정의 모델 선택기가 제공자의 지원 모델 카탈로그를 함께 사용하며, OpenCode 검색과 기존 기본값·레거시 모델을 그대로 보존합니다.",
          "채널 에이전트가 작업 공간의 스크린샷과 이미지를 안전한 경로·크기 제한 안에서 답변에 첨부할 수 있습니다.",
          "Work 분석 차트에 완료 이슈와 토큰을 위한 양쪽 Y축 눈금을 추가하고, 로딩 스피너가 원의 중심에서 정확히 회전하도록 다듬었습니다.",
          "반복 오류 토스트를 한 항목으로 모으고, 민감한 값을 제거한 시각·앱 버전·요청·상태·환경·스택 진단 정보를 복사할 수 있습니다.",
        ],
      },
      {
        version: "1.2.114",
        date: "2026년 8월 13일",
        title: "Worker가 지원하는 모델로 바로 작업을 배정합니다",
        summary:
          "작업 배정 화면이 각 제공자가 실제로 지원한다고 보고한 모델 목록을 사용해 새 모델도 바로 선택하고 실행할 수 있습니다.",
        items: [
          "Worker 작업 배정 화면을 열면 Codex, Claude, Grok, OpenCode가 현재 지원하는 모델 목록을 불러와 제공자별 선택지에 반영합니다.",
          "모델 목록은 앱 세션 동안 한 번만 요청해 설정과 작업 배정 화면이 같은 결과를 재사용하고, 조회가 실패하면 기본 모델 목록으로 안전하게 돌아갑니다.",
          "서버는 제공자가 보고한 새 모델 ID를 작업 배정 요청에서 허용하면서도 저장된 이슈 실행 기본값에는 기존 검증 규칙을 유지합니다.",
        ],
      },
      {
        version: "1.2.113",
        date: "2026년 8월 13일",
        title: "이슈 대화와 실행 결과를 더 빠르고 선명하게 확인합니다",
        summary:
          "이슈 대화를 실시간으로 동기화하고, 에이전트 수행 로그와 예상 API 비용, 새 앱 업데이트를 한눈에 확인할 수 있도록 다듬었습니다.",
        items: [
          "채널과 이슈 대화가 조직 WebSocket 연결을 공유하고 프로젝트 cursor 기반 delta를 받아, 에이전트 답변과 제안 상태를 폴링 없이 실시간으로 갱신합니다.",
          "이슈와 Project Agent 세션이 같은 수행 로그를 사용하며 최초·후속 요청은 별도 카드로 구분하고, 로그 내보내기와 자동 스크롤을 일관되게 제공합니다.",
          "실제 토큰 원장과 가격표를 연결해 실행별·모델별 예상 API 비용, 입력·출력 단가와 가격 확인 시각을 결과 화면에 표시합니다.",
          "새 앱 버전이 있으면 다운로드 버튼을 눈에 띄게 강조하되 hover와 설치 중에는 멈추고 모션 감소 설정을 존중합니다.",
          "랜딩 공유 미리보기를 Briar 작업 보드가 포함된 새 소셜 카드와 제품 메시지로 교체했습니다.",
        ],
      },
      {
        version: "1.2.112",
        date: "2026년 8월 12일",
        title: "데스크탑 설정과 채널 운영 도구를 강화합니다",
        summary:
          "macOS 설정·업데이트 흐름과 보안 입력 처리를 안정화하고, 채널 기록·Worker 상태·공개 문서를 확장했습니다.",
        items: [
          "macOS 앱 메뉴에서 설정과 업데이트 확인을 바로 열 수 있고, 새 버전이 있으면 메뉴 문구가 업데이트 동작으로 바뀝니다.",
          "macOS 창이 포커스를 잃을 때 비밀번호 입력을 위한 보안 입력 상태를 정리해 다른 앱의 키 입력을 가로채지 않도록 했습니다.",
          "Briar CLI와 Project Agent가 권한이 있는 채널의 과거 메시지와 스레드를 페이지 단위로 읽을 수 있고, 채널 접근 규칙을 Worker에서 검증합니다.",
          "Worker 상태 새로고침, HTTPS 프로필 아바타, 이슈 생성자 보존과 공개 API·LLM 문서를 추가해 운영과 자동화 맥락을 더 분명하게 확인할 수 있습니다.",
        ],
      },
      {
        version: "1.2.111",
        date: "2026년 8월 12일",
        title: "채널 자동화와 프로젝트 운영 가시성을 강화합니다",
        summary:
          "외부 이벤트를 채널로 연결하고, 프로젝트 현황·승인 흐름·데스크탑 알림의 맥락을 더 분명하게 확인할 수 있습니다.",
        items: [
          "채널별 수신 웹훅을 만들고 이름을 바꾸거나 교체·폐기할 수 있으며, 비밀값은 한 번만 보여주고 중복 이벤트와 과도한 요청을 방지합니다.",
          "프로젝트 홈에서 기간별 사용량과 실행 주체를 확인하고, 칸반 단계 열을 사용자별로 접거나 펼쳐 긴 작업 보드를 더 빠르게 살펴볼 수 있습니다.",
          "채널에서 이슈 실행 승인을 처리할 때 원래 대화 맥락을 유지하고, 전송 후 스레드가 최신 답글 위치로 이동하도록 다듬었습니다.",
          "macOS 알림을 클릭하면 해당 채널 메시지와 스레드로 바로 이동해 알림을 확인한 뒤 같은 맥락에서 작업을 이어갈 수 있습니다.",
        ],
      },
      {
        version: "1.2.110",
        date: "2026년 8월 12일",
        title: "이슈를 구독하고 프로젝트 현황을 더 빠르게 확인합니다",
        summary:
          "관심 있는 이슈의 알림 범위를 직접 관리하고, 프로젝트 홈과 채널 작성기가 필요한 정보와 입력 내용에 맞춰 더 효율적으로 반응합니다.",
        items: [
          "이슈 대화에서 구독하거나 해제하고 현재 구독자 아바타를 확인할 수 있으며, 담당자는 중요한 변경을 놓치지 않도록 자동 구독됩니다.",
          "이슈 상태와 대화 알림을 구독자에게만 Inbox와 시스템 알림으로 전달하고, 데스크탑·Android·iOS에서 같은 구독 상태를 사용합니다.",
          "프로젝트 홈의 최근 30일 사용량을 D1에서 프로젝트 단위로 집계하고 캐시해 조직 전체 실행 기록을 반복해서 읽지 않습니다.",
          "채널 입력창이 줄바꿈과 자동 줄바꿈에 맞춰 140px까지 자연스럽게 커지고, 그 이후에는 내부 스크롤을 유지합니다.",
        ],
      },
      {
        version: "1.2.109",
        date: "2026년 8월 12일",
        title: "에이전트 핸들을 직접 정하고 실시간 채널 연결을 복원합니다",
        summary:
          "프로젝트 에이전트의 채널 호출용 @핸들을 직접 관리하고, 패키징된 데스크탑과 Android에서도 인증된 실시간 채널 연결을 사용합니다.",
        items: [
          "프로젝트 에이전트를 만들거나 설정할 때 기억하기 쉬운 @핸들을 지정하고, 이름 기반 자동 생성값도 바로 확인할 수 있습니다.",
          "조직 안에서 중복되는 핸들은 안전한 suffix로 구분하고 비라틴 이름, 긴 핸들, 동시 생성 충돌도 고유하게 처리합니다.",
          "Worker가 에이전트 핸들의 예약과 변경을 조직 범위에서 검증해 채널 멘션 대상을 안정적으로 유지합니다.",
          "데스크탑과 Android의 보안 정책에 Briar API 전용 WSS 연결을 허용해 채널 변경을 주기적 폴링 대신 실시간으로 수신합니다.",
        ],
      },
      {
        version: "1.2.108",
        date: "2026년 8월 12일",
        title: "프로젝트 현황과 에이전트 동기화를 한눈에 확인합니다",
        summary:
          "프로젝트별 홈 로비에서 최근 사용량과 실행 상태를 빠르게 확인하고, Inbox·Worker·채널 동기화가 실제로 바뀐 데이터만 처리하도록 다듬었습니다.",
        items: [
          "프로젝트 로비에서 최근 30일 사용량, 실행 시간, 이슈 상태, GitHub 연결 상태와 최근 활동을 한 화면에 보여줍니다.",
          "조직 Inbox 스냅샷과 Worker claim polling이 변경이 없을 때 불필요한 응답·쿼리를 건너뛰어 동기화 비용을 줄입니다.",
          "Worker lease 갱신과 자격 증명 사용량 기록을 묶어 쓰고, 채널 실시간 연결은 유휴 상태에서 잠들 수 있어 운영 부하를 낮춥니다.",
          "긴 에이전트 transcript 쓰기를 배치 처리하고 멘션 입력 caret 위치를 맞춰 실행 기록과 대화 편집 경험을 안정화했습니다.",
        ],
      },
      {
        version: "1.2.107",
        date: "2026년 8월 12일",
        title: "모바일 채널을 자연스럽게 다듬고 반복 알림을 멈춥니다",
        summary:
          "모바일 채널의 네이티브 탐색과 입력 경험을 복원하고, 같은 에이전트 세션이 여러 번 알림으로 나타나지 않도록 Inbox 동기화를 안정화했습니다.",
        items: [
          "iOS 채널 상세에 시스템 내비게이션 바와 뒤로가기, 네이티브 메시지 입력과 첨부·전송 버튼을 적용했습니다.",
          "Android 공용 채널 화면도 투명한 모바일 레이아웃과 일관된 버튼을 사용하고, 스레드에서 채널 목록까지 뒤로가기를 순서대로 처리합니다.",
          "완료·실패한 에이전트 세션의 Inbox 버전을 데스크탑과 Worker에서 하나로 맞춰 같은 상태가 반복해서 OS 알림을 만들지 않도록 했습니다.",
          "D1의 기존 세션 요약과 읽음 상태를 표준 버전으로 이전하면서 이미 읽은 세션은 읽음으로 유지합니다.",
          "제품 설명을 클라우드 조정과 로컬 실행 구조에 맞춰 정리해 저장소와 실행 위치를 더 정확하게 안내합니다.",
        ],
      },
      {
        version: "1.2.106",
        date: "2026년 8월 12일",
        title: "프로젝트를 바꿔도 모든 Inbox 알림을 놓치지 않습니다",
        summary:
          "선택한 프로젝트와 관계없이 접근 가능한 조직 전체의 이슈, 대화, 채널과 에이전트 알림을 한곳에 모아 주기적으로 동기화합니다.",
        items: [
          "조직 안의 모든 프로젝트에서 이슈 상태, 답글과 멘션, 채널 알림, 에이전트 세션을 인증된 Inbox 피드로 모읍니다.",
          "데스크탑과 Android 공용 앱은 선택한 프로젝트의 상세 데이터와 조직 피드를 합치고 포그라운드에서 15초마다 갱신합니다.",
          "읽음 버전을 완료 이벤트와 일치시키고 첫 동기화 기준선을 적용해 과거 알림이 한꺼번에 다시 울리지 않도록 합니다.",
          "iOS Companion도 같은 조직 Inbox 모델과 포그라운드 동기화 흐름을 사용합니다.",
        ],
      },
      {
        version: "1.2.105",
        date: "2026년 8월 11일",
        title: "프로젝트 대화 에이전트가 실제 작업 환경에서 검증합니다",
        summary:
          "채널과 이슈의 Project Agent가 프로젝트 Worker와 같은 실행 권한을 사용해 개발 서버, 브라우저 자동화와 로컬 검증을 직접 수행합니다.",
        items: [
          "프로젝트 채널과 이슈 대화 에이전트가 프로젝트 Worker와 같은 셸, 네트워크, 브라우저, 파일시스템과 환경 설정을 사용합니다.",
          "새 대화 작업 공간에도 `.worktreeinclude` 입력을 복사해 로컬 실행에 필요한 gitignore 파일을 안전하게 제공합니다.",
          "각 대화는 분리된 일회용 worktree에서 실행되어 응답이 끝나면 로컬 변경을 폐기합니다.",
          "Briar 이슈 변경과 실행 제안은 기존 인증된 확인 절차를 그대로 유지합니다.",
        ],
      },
      {
        version: "1.2.104",
        date: "2026년 8월 11일",
        title: "실시간 협업과 에이전트 동기화를 더 가볍고 정확하게 만듭니다",
        summary:
          "채널과 에이전트 화면이 필요한 변경만 받아오고, 조직과 프로젝트가 커져도 대화·세션·대시보드 상태를 빠르고 정확하게 유지합니다.",
        items: [
          "채널 변경 알림을 SSE로 받고 delta API에서 새 항목만 가져오며, 연결이 끊겨도 주기적인 복구 동기화로 누락을 방지합니다.",
          "Project Agent 세션 목록은 가벼운 요약과 cursor delta로 동기화하고, 전체 로그와 보관된 결과는 세션을 열 때만 불러옵니다.",
          "Organization Agent가 질문에 필요한 프로젝트 설정, Agent·Skill, 이슈·PR과 세션 정보만 권한 범위 안에서 요청해 읽습니다.",
          "macOS 상태 트레이는 조직 전체의 실행 중 작업을 한 번에 조회하고, 대시보드는 실제로 바뀐 실행의 관계 데이터만 읽습니다.",
          "Worker 배포가 먼저 D1 마이그레이션을 적용한 뒤 새 코드를 올리도록 고정하고, 반복되는 실행 요청에서 불필요한 스키마 확인 쿼리를 제거했습니다.",
          "이슈 상세에서 확인한 답글과 상태 알림은 함께 읽음 처리하되 관련 없는 Inbox 알림은 그대로 유지합니다.",
          "완료된 이슈도 마지막으로 작업한 Worker를 상세 화면과 결과 지표에 보존해 실행 주체를 계속 확인할 수 있습니다.",
        ],
      },
      {
        version: "1.2.103",
        date: "2026년 8월 11일",
        title: "프로젝트 에이전트 실행 승인을 더 안전하게 배포합니다",
        summary:
          "자연어로 요청한 Project Agent Skill 실행을 명시적인 승인 단계로 보호하고, 운영 마이그레이션과 멘션·이미지·이슈 화면을 더 안정적으로 다듬었습니다.",
        items: [
          "대화에서 Project Agent Skill 실행을 요청하면 먼저 읽기 전용 제안을 만들고, 사용할 Worker와 정확한 실행 내용을 확인한 뒤 승인합니다.",
          "승인된 실행의 에이전트·스킬·요청·Worker 정보를 감사 기록으로 보존하고, 승인되지 않았거나 오래된 요청이 실행되지 않도록 서버에서 검증합니다.",
          "채널 에이전트 위임 스키마의 트리거를 Wrangler가 한 문장으로 인식하도록 표준 구문과 마이그레이션 경계를 적용했습니다.",
          "연결된 사람과 에이전트 멘션을 메시지 안에서 바로 알아보고 누를 수 있는 버튼으로 표시합니다.",
          "새로고침 뒤에도 대화 이미지가 유지되고, 실제 스레드가 없을 때 불필요한 답글 링크를 숨깁니다.",
          "이슈 헤더의 속성과 작업 메뉴를 정리하고 배정 배지를 다듬어 중요한 상태와 동작을 더 빠르게 찾을 수 있습니다.",
        ],
      },
      {
        version: "1.2.100",
        date: "2026년 8월 11일",
        title: "대화형 이슈와 에이전트 협업을 더 안전하게 운영합니다",
        summary:
          "채널에서 이슈 생성과 실행을 승인 단계로 보호하고, Organization Agent가 프로젝트 맥락을 읽고 위임할 수 있도록 하면서 데스크톱·iOS 동기화와 편집 경험을 다듬었습니다.",
        items: [
          "채널 대화에서 이슈를 만들거나 실행하기 전에 제안과 승인 화면으로 의도를 확인하고, Inbox와 모바일에서도 같은 상태를 처리합니다.",
          "Organization Agent가 필요한 읽기 전용 프로젝트 질문을 정확한 Project Agent에 위임하고, 권한 범위와 실행 상태를 안전하게 분리합니다.",
          "데스크톱과 iOS Inbox 읽음 상태를 포커스·포그라운드와 계정 전환에 맞춰 동기화해 오래된 읽지 않음 표시를 줄입니다.",
          "이슈 편집 중 첨부 파일을 인라인으로 확인하고, Inbox 사이드 패널에서도 대기 중인 이슈 제안을 바로 승인할 수 있습니다.",
          "iOS Companion을 한국어·영어로 현지화하고 실행 알림과 로그 표시를 더 정확하게 다듬었습니다.",
        ],
      },
      {
        version: "1.2.99",
        date: "2026년 8월 10일",
        title: "동시 작업과 긴 대화를 더 안정적으로 처리합니다",
        summary:
          "같은 프로젝트 에이전트에서 여러 작업을 동시에 시작할 수 있고, 긴 링크·코드·표가 이슈 대화 패널 너비를 넘지 않도록 표시를 안정화했습니다.",
        items: [
          "첫 번째 작업이 실행 중이어도 같은 프로젝트 에이전트에서 다른 스킬 작업을 시작할 수 있습니다.",
          "동시에 실행하는 작업을 별도 세션으로 추적해 각 작업의 진행과 결과를 독립적으로 확인합니다.",
          "긴 URL, 코드 블록과 Markdown 표를 이슈 대화 패널 안에서 줄바꿈하거나 내부 스크롤로 표시해 가로 스크롤을 방지합니다.",
        ],
      },
      {
        version: "1.2.98",
        date: "2026년 8월 10일",
        title: "대화와 실행 상태를 더 정확하게 확인합니다",
        summary:
          "답글 참여자, 실제 실행 상태와 인라인 편집을 더 분명하게 보여주고, 채널 이모지 선택과 에이전트 인증 실패를 더 안전하게 처리합니다.",
        items: [
          "대화 답글에 참여한 사람을 요약해 누가 대화에 참여했는지 바로 확인합니다.",
          "이슈 내용을 화면에서 바로 수정하고, 알림 제목에도 실제 실행 상태를 표시합니다.",
          "채널 이모지 피커가 화면 밖으로 잘리지 않도록 위치를 조정합니다.",
          "선택 사항인 MCP 인증 실패를 전체 에이전트 실행 실패로 확장하지 않도록 격리합니다.",
          "iOS 작업 화면에서 중복으로 표시되던 로딩 스피너를 제거했습니다.",
        ],
      },
      {
        version: "1.2.97",
        date: "2026년 8월 10일",
        title: "채널 메시지에 이모지로 바로 반응합니다",
        summary:
          "채널 대화에서 빠른 이모지와 전체 피커를 사용해 메시지에 반응하고, 데스크탑·Companion·iOS 어디서든 같은 반응을 확인할 수 있습니다.",
        items: [
          "메시지에 마우스를 올려 👍, ❤️, 😂, 🎉 빠른 반응을 남기거나 전체 이모지 피커에서 원하는 반응을 선택합니다.",
          "반응 칩에 참여 인원과 내가 남긴 반응을 표시하고, 같은 이모지를 다시 누르면 반응을 취소합니다.",
          "채널 델타 동기화가 반응 추가와 삭제를 즉시 전달해 여러 기기에서 메시지 상태를 일관되게 유지합니다.",
          "데스크탑과 Companion 웹, iOS Companion이 같은 반응 모델과 토글 동작을 사용합니다.",
        ],
      },
      {
        version: "1.2.96",
        date: "2026년 8월 10일",
        title: "실행 비용과 Worker 상태를 더 정확하게 운영합니다",
        summary:
          "에이전트 사용량 원장을 실제 운영 화면에 연결하고, 제공자 비용이 없는 실행도 현재 요금으로 추정해 Worker별 사용량과 비용을 한눈에 확인할 수 있습니다.",
        items: [
          "설정의 사용량 화면에서 실행 원장에 저장된 토큰과 제공자 비용을 Worker·제공자·모델별로 집계해 보여줍니다.",
          "제공자가 비용을 보고하지 않은 실행은 현재 모델 요금표로 계산해 누락된 운영 비용을 보완합니다.",
          "Worker 환경 패널에서 설치된 Briar 버전과 업데이트 가능 여부를 확인하고 원격 업데이트를 바로 요청할 수 있습니다.",
          "이슈를 만들 때 Full Auto를 켜면 모든 체크포인트를 건너뛰고 중단 없이 처리하며, 데스크탑과 iOS에서 같은 설정을 사용합니다.",
          "Inbox의 채널 답글 알림을 열면 채널 화면의 정확한 대화로 이동해 답글 맥락을 바로 확인할 수 있습니다.",
          "프로젝트 에이전트 작업을 전달한 뒤 실행 대화상자가 즉시 닫혀 중복 요청 없이 결과 화면으로 자연스럽게 이어집니다.",
        ],
      },
      {
        version: "1.2.95",
        date: "2026년 8월 10일",
        title: "에이전트 사용량과 비용을 실행별로 확인합니다",
        summary:
          "Codex, Claude, Grok, OpenCode 실행의 토큰 사용량과 제공자 비용을 서버에 기록해 Worker 상태와 운영 비용을 더 정확하게 파악할 수 있습니다.",
        items: [
          "실행별 입력·출력·캐시·추론 토큰과 제공자가 보고한 비용을 사용량 원장에 영구 저장합니다.",
          "기존 Codex와 Claude에 더해 OpenCode와 Grok 사용량을 수집하고, 한도를 소진한 제공자는 Worker 실행 가능 목록에서 제외합니다.",
          "직접 실행, 예약과 이슈 처리에서 사용할 에이전트 스킬을 명시적으로 선택해 작업마다 의도한 설정을 안정적으로 유지합니다.",
          "이슈의 상태와 우선순위 배지를 바로 눌러 변경할 수 있고, 에이전트 오류는 화면을 가리는 배너 대신 토스트로 표시합니다.",
          "채널과 이슈의 첨부 파일 처리, 멘션 입력, 패널 크기 조절과 모바일 화면의 공통 동작을 정리해 협업 흐름을 안정화했습니다.",
        ],
      },
      {
        version: "1.2.94",
        date: "2026년 8월 10일",
        title: "모든 에이전트의 작업 과정을 같은 흐름으로 보여줍니다",
        summary:
          "Codex, Claude, Grok, OpenCode가 보내는 진행 이벤트를 하나의 형식으로 맞춰 메시지와 도구 활동을 더 일관되고 안정적으로 표시합니다.",
        items: [
          "에이전트의 답변 시작·진행·완료와 턴 종료 상태를 제공자에 관계없이 같은 이벤트 흐름으로 처리합니다.",
          "명령 실행, 파일 변경, 웹 검색과 기타 도구 활동의 시작·출력·완료 상태를 공통 형식으로 보여줍니다.",
          "Worker에서 이어받은 활동 ID를 세션별로 분리해 여러 실행의 진행 이벤트가 서로 섞이지 않습니다.",
          "아주 긴 활동 제목과 출력도 UTF-8 문자를 안전하게 보존하며 제한해 실시간 실행 화면을 안정적으로 유지합니다.",
        ],
      },
      {
        version: "1.2.93",
        date: "2026년 8월 10일",
        title: "에이전트마다 여러 스킬을 만들고 알맞은 작업에 사용합니다",
        summary:
          "하나의 에이전트에 목적별 스킬을 구성하고, 직접 실행·예약·이슈 처리·채널 대화에서 작업에 맞는 스킬을 선택해 실행할 수 있습니다.",
        items: [
          "프로젝트와 조직 에이전트에 여러 스킬을 만들고 각각 이름, 지침, 제공자, 모델과 추론 강도를 설정할 수 있습니다.",
          "에이전트를 직접 실행할 때마다 원하는 스킬을 선택하고, 이슈 처리에는 전용 스킬을 사용하며 예약 실행에는 전체 스킬 목록을 전달합니다.",
          "채널에서 에이전트와 저장된 스킬 이름을 함께 언급하면 해당 스킬로 답변하고, 일치하는 이름이 없으면 에이전트의 책임과 전체 스킬 목록 안에서 판단합니다.",
          "대기 중이거나 실행 중인 작업이 선택한 스킬을 안전하게 보존해 이름이나 실행 설정을 바꿔도 실행 맥락이 유지됩니다.",
        ],
      },
      {
        version: "1.2.92",
        date: "2026년 8월 9일",
        title: "에이전트 작업을 이어가고 사용량을 더 선명하게 확인합니다",
        summary:
          "완료된 에이전트 세션에도 후속 요청을 이어서 보낼 수 있고, 사용량 현황과 첨부 파일 전달 흐름을 더 일관되게 확인할 수 있습니다.",
        items: [
          "완료된 프로젝트 에이전트 세션에서 같은 대화와 작업 공간을 유지한 채 후속 작업을 시작할 수 있습니다.",
          "설정의 사용량 대시보드에서 에이전트 사용량을 더 자세히 확인할 수 있습니다.",
          "지원되는 에이전트 실행 경로가 대화 첨부 파일을 같은 방식으로 전달해 이미지와 파일 입력의 연결을 안정화했습니다.",
          "iOS에서 접근성 글자 크기에서도 프로젝트 전환 메뉴를 유지하고, 채널 메시지 이미지 첨부 흐름을 개선했습니다.",
        ],
      },
      {
        version: "1.2.91",
        date: "2026년 8월 8일",
        title: "중요한 실행 순간만 놓치지 않도록 알림을 정리했습니다",
        summary:
          "진행 중인 상태 변화로 Inbox가 붐비지 않도록 알림을 결정과 종료 시점에 집중하고, 에이전트 실행 연결과 칸반 카드 표시를 더 정확하게 다듬었습니다.",
        items: [
          "백로그, 대기, 실행 중, 단계 변경은 새 Inbox 메시지나 알림을 만들지 않습니다.",
          "일시정지, 완료, 실패, 차단처럼 확인이나 대응이 필요한 실행 상태만 Inbox에 표시합니다.",
          "데스크톱과 iOS에서 에이전트 실행 ID를 같은 소문자 형식으로 보내 실행 요청이 안정적으로 연결됩니다.",
          "칸반 카드에 배정된 Worker 아바타를 복원하고 중복된 단계 아이콘을 제거했습니다.",
        ],
      },
      {
        version: "1.2.90",
        date: "2026년 8월 8일",
        title: "워크플로와 에이전트 실행을 더 안정적으로 이어갑니다",
        summary:
          "워크플로 체크포인트를 하나의 v2 규칙으로 정리하고, 에이전트 작업과 스레드 답글이 중간에 끊기거나 잘못 연결되지 않도록 실행 흐름을 강화했습니다.",
        items: [
          "프로젝트와 실행 워크플로를 표준 v2 체크포인트 모델로 통합해 승인과 재개 상태를 일관되게 관리합니다.",
          "에이전트가 한 번의 응답으로 작업을 마치지 못해도 같은 대화와 작업 공간에서 활성 실행을 계속 진행합니다.",
          "에이전트 작업 요청 경로를 정적 자산보다 먼저 정확히 처리해 Worker가 작업을 안정적으로 가져옵니다.",
          "데스크톱과 iOS의 스레드 답글이 서버에 저장된 기준 메시지 ID를 사용해 에이전트 응답을 올바른 대화에 연결합니다.",
          "칸반 카드의 이슈 출처와 Worker 배지를 바로잡아 실행 정보를 더 정확하게 표시합니다.",
        ],
      },
      {
        version: "1.2.89",
        date: "2026년 8월 8일",
        title: "에이전트 실행 결과를 더 정확하게 반영합니다",
        summary:
          "저장된 에이전트가 맡은 책임을 실제 완료 목표로 수행하고, 실행 결과와 세션 상태를 일치시켜 진행 상황을 더 신뢰할 수 있습니다.",
        items: [
          "저장된 에이전트의 책임을 역할 설명이 아니라 끝까지 달성해야 할 명시적인 실행 목표로 전달합니다.",
          "해결 가능한 사전 조건과 복구 작업을 에이전트가 직접 처리하고, 결과를 검증한 뒤 완료로 보고합니다.",
          "즉시 실행과 예약 실행 모두 구조화된 결과가 완료일 때만 세션을 완료 상태로 표시합니다.",
          "부분 완료, 차단, 실패 또는 결과 누락을 성공으로 표시하지 않아 실행 이력을 더 정확하게 확인할 수 있습니다.",
        ],
      },
      {
        version: "1.2.88",
        date: "2026년 8월 8일",
        title: "원하는 Worker에서 에이전트를 바로 실행합니다",
        summary:
          "저장된 에이전트를 선택한 Worker의 최신 코드에서 실행하고, 데스크톱과 iOS에서 진행 상태와 결과를 더 안정적으로 이어서 확인할 수 있습니다.",
        items: [
          "저장된 에이전트 작업을 선택한 Worker에서 실행하고, 매 실행을 최신 main의 새 worktree에서 시작합니다.",
          "프로젝트 에이전트 작업 잡을 서버에서 추적해 실행 상태와 결과를 안정적으로 동기화합니다.",
          "iOS에서 프로젝트 에이전트를 실행하고 진행 상태와 결과를 확인할 수 있습니다.",
          "채널 알림, 멘션 링크, 이슈 자동완성, 메시지 전송 동작과 채널 상세 헤더를 개선했습니다.",
          "랜딩을 하나의 밝은 테마와 명시적인 한국어·영어 경로로 전면 개편했습니다.",
        ],
      },
      {
        version: "1.2.87",
        date: "2026년 8월 7일",
        title: "조직 에이전트와 채널 실행 흐름을 확장했습니다",
        summary:
          "조직 단위 에이전트를 직접 관리하고, 채널의 멘션과 이슈 제안 흐름을 데스크톱과 모바일에서 더 매끄럽게 이어갈 수 있습니다.",
        items: [
          "조직 설정에서 저장소에 속하지 않은 에이전트를 만들고 조회하거나 삭제할 수 있습니다.",
          "에이전트를 만들 때 제공자, 모델, 추론 강도와 담당 역할을 함께 설정할 수 있습니다.",
          "채널에서 @를 입력하면 전체 멤버와 에이전트 후보가 다시 빠짐없이 표시됩니다.",
          "모바일 웹과 iOS에서 채널의 이슈 생성 제안을 승인하고 대상 프로젝트와 생성된 이슈로 바로 이동할 수 있습니다.",
          "랜딩의 제품 미리보기를 실제 Briar 작업 흐름을 보여주는 데모 영상으로 개선했습니다.",
        ],
      },
      {
        version: "1.2.86",
        date: "2026년 8월 7일",
        title: "사람과 Worker를 더 선명하게 연결합니다",
        summary:
          "프로필과 멘션의 맥락을 풍부하게 만들고, 원격 Worker 업데이트와 데스크톱 종료 흐름을 더 안전하게 다듬었습니다.",
        items: [
          "채널 멘션에서 사람과 에이전트의 프로필을 열어 이름, 역할, 활동 정보를 확인할 수 있습니다.",
          "조직 Worker의 원격 업데이트 상태를 확인하고 새 버전을 더 안전하게 적용할 수 있습니다.",
          "Cmd+Q로 앱을 종료하기 전에 확인해 실수로 작업 창을 닫는 일을 방지합니다.",
          "이슈 카드 배지에서 불필요한 소스 점 아이콘을 제거해 상태 정보를 간결하게 표시합니다.",
        ],
      },
      {
        version: "1.2.85",
        date: "2026년 8월 7일",
        title: "채널 협업이 더 풍부해졌습니다",
        summary:
          "이미지, 초대, 메시지 관리, 계획 문서를 채널 안에서 자연스럽게 다룰 수 있도록 협업 흐름을 확장했습니다.",
        items: [
          "채널 메시지에 이미지를 첨부하고 에이전트 비전 입력으로 전달할 수 있습니다.",
          "채널 초대 대화상자와 메시지 편집·삭제 기능을 추가했습니다.",
          "Ideas를 채널 계획 문서로 통합해 대화와 실행 계획을 한곳에 모았습니다.",
          "이슈 이미지 편집, 오류 토스트, 담당자·Worker 아바타와 실행 버튼을 개선했습니다.",
          "Briar를 Apache License 2.0으로 공개했습니다.",
        ],
      },
      {
        version: "1.2.84",
        date: "2026년 8월 7일",
        title: "데스크톱 채널 대화를 새롭게 설계했습니다",
        summary:
          "채널 목록부터 대화 스레드까지 정보 밀도와 읽기 흐름을 다듬어 팀 대화를 더 빠르게 파악할 수 있습니다.",
        items: [
          "데스크톱 채널 대화 화면의 구조와 시각적 계층을 전면 개선했습니다.",
          "채널과 프로젝트 맥락을 오가며 대화 내용을 더 쉽게 추적할 수 있습니다.",
        ],
      },
      {
        version: "1.2.83",
        date: "2026년 8월 7일",
        title: "멘션 선택이 더 빠르고 정확해졌습니다",
        summary:
          "채널에서 사람과 에이전트를 호출할 때 필요한 대상을 더 쉽게 찾고 선택할 수 있습니다.",
        items: [
          "채널 멘션 선택기의 탐색과 선택 경험을 개선했습니다.",
          "PR 전 빠른 검증 절차를 문서에 명확히 정리했습니다.",
        ],
      },
      {
        version: "1.2.82",
        date: "2026년 8월 7일",
        title: "모바일 이슈 식별자를 더 간결하게 표시합니다",
        summary:
          "작은 화면에서도 이슈 번호와 상태를 빠르게 읽을 수 있도록 불필요한 표기를 정리했습니다.",
        items: [
          "모바일 이슈 키의 천 단위 쉼표를 제거했습니다.",
          "이슈 키 옆의 중복 단계 아이콘을 제거해 목록 가독성을 높였습니다.",
        ],
      },
      {
        version: "1.2.81",
        date: "2026년 8월 7일",
        title: "이슈 생성과 프로젝트 동기화를 안정화했습니다",
        summary:
          "언어별 제목 규칙과 프로젝트 선택을 바로잡고 앱 시작 시 로컬 워크플로 상태를 신뢰할 수 있게 맞췄습니다.",
        items: [
          "언어 특성을 고려해 이슈 제목 길이 제한을 적용합니다.",
          "클릭한 프로젝트가 새 이슈 대화상자에 정확히 선택됩니다.",
          "앱 시작 시 로컬 프로젝트 워크플로를 자동으로 동기화합니다.",
        ],
      },
      {
        version: "1.2.80",
        date: "2026년 8월 7일",
        title: "모바일과 데스크톱 채널 화면을 넓게 다듬었습니다",
        summary:
          "기기 크기에 맞춰 채널 대화가 자연스럽게 확장되도록 레이아웃과 빌드 호환성을 개선했습니다.",
        items: [
          "모바일 채널 대화 화면의 탐색과 메시지 레이아웃을 개선했습니다.",
          "데스크톱 채널 UI가 사용 가능한 셸 너비를 모두 활용합니다.",
          "iOS 채널 빌드 호환성을 복구했습니다.",
        ],
      },
    ],
  },
  en: {
    metadata: {
      title: "Briar changelog — New features and improvements",
      description:
        "See the latest updates to Briar desktop, channels, mobile, and agent workflows.",
    },
    eyebrow: "PRODUCT UPDATES",
    title: "Briar changelog",
    description:
      "A running record of the features and improvements that make collaboration between people and agents clearer.",
    current: "Current stable release",
    latest: "Latest",
    released: "Released",
    openApp: "Open Briar",
    allReleases: "View all releases",
    releaseNotes: "Open GitHub release",
    home: "Home",
    backTop: "Back to top ↑",
    entries: [
      {
        version: "1.2.128",
        date: "August 16, 2026",
        title: "Keep sent messages flowing naturally",
        summary:
          "Messages still appear immediately after sending, now without a transient status label interrupting the conversation.",
        items: [
          "Remove the sending label from optimistic messages in channel, issue, and Companion conversations while keeping the author, timestamp, and content layout stable before and after server confirmation.",
        ],
      },
      {
        version: "1.2.127",
        date: "August 16, 2026",
        title: "Make live conversations and sending feel immediate",
        summary:
          "Sent messages appear right away, agent activity streams live, and mobile conversations recover their position and state more reliably.",
        items: [
          "Stream live progress from issue conversations and channel agents, then clear the activity cleanly when work finishes or the connection closes.",
          "Show channel and issue messages immediately after sending and use stable client message IDs to prevent duplicates while replies, attachments, and server sync catch up.",
          "Let mobile users long-press to select and copy long channel messages, and provide a button to return to the newest messages when they scroll away.",
          "Improve mobile channel and issue conversation caching, re-entry, and loading states so stale replies disappear and new messages appear sooner.",
          "Show the actual Worker name for agent sessions so the environment handling a run is easier to identify than a raw UUID.",
        ],
      },
      {
        version: "1.2.126",
        date: "August 15, 2026",
        title: "Make first-run setup and conversation results faster and more precise",
        summary:
          "Clarify role-based onboarding, structured channel messages, realtime issue conversations, and agent responses from start to finish.",
        items: [
          "Split invited-user, developer, and collaborator paths after a shared introduction and Google sign-in, then show clear workflow-generation stages, elapsed time, and finalization progress.",
          "Render text, sections, fields, dividers, context, and images from Slack Block Kit webhook messages directly in channels while preserving the original blocks in the database.",
          "Clear stale result screenshots when switching issues, synchronize open issue conversations in realtime, and suppress duplicate notifications for replies already being viewed.",
          "Replace issue-response and channel-agent wait spinners with the pixel-grid loader, a descriptive status, and elapsed time so longer work remains easy to follow.",
          "Normalize structured approval replies and channel mention UUIDs reliably, and improve native iOS initial channel loading and immediate draft clearing after send.",
        ],
      },
      {
        version: "1.2.125",
        date: "August 15, 2026",
        title: "Connect Inbox replies and narrow issue views more naturally",
        summary:
          "Recognize reply authors at a glance and move comfortably between description, status, and conversation when an issue view gets narrow.",
        items: [
          "Show the actual author's avatar on issue-conversation reply notifications across desktop, Android, and native iOS instead of a generic icon, with a safe initial fallback when an image is missing or fails to load.",
          "Move the conversation pane into its own Messages tab when the issue detail area is narrower than 960px, sharing the full width with Description, Activity, and Status before returning naturally to the split pane at wider sizes.",
          "Refresh the landing site's production dependencies to remove known production vulnerabilities while preserving its existing Cloudflare Worker build and behavior.",
        ],
      },
      {
        version: "1.2.124",
        date: "August 15, 2026",
        title: "Connect channel conversations and agent progress faster",
        summary:
          "Switch channels faster, follow agent activity live, and improve the responsiveness of Inbox and background synchronization.",
        items: [
          "Stream command, file, search, and tool activity for channel agents at the reply level, restore active work after reconnecting, and redact sensitive values before they are published.",
          "Open desktop channels immediately from cache with the latest 20 messages, load older history when scrolling upward, and virtualize long conversations while preventing stale results during rapid switching.",
          "Keep notification-opened reply threads visible, show agent providers as accessible icons, and let long issue descriptions fill and scroll within the remaining pane height.",
          "Prefer the current organization's local Worker for channel replies when it can run the job, with a safe fallback to another Worker on failure.",
          "Index Inbox notification targets and GitHub merge-reconciliation candidates, and consolidate idle project synchronization around organization-level realtime updates to reduce unnecessary requests and database work.",
        ],
      },
      {
        version: "1.2.123",
        date: "August 14, 2026",
        title: "Make images, Inbox senders, and loading progress clearer",
        summary:
          "Open and download images more easily, identify channel senders in Inbox, make longer waits clearer, and refresh the landing demo.",
        items: [
          "Open channel images, issue Markdown and attachments, and run evidence screenshots in a larger lightbox, then download them while preserving the original filename.",
          "Show the actual sender avatar on channel Inbox rows across desktop, Android, and native iOS instead of an arbitrary project icon, with a safe initial fallback when an image is missing or fails to load.",
          "Replace circular spinners on potentially longer Inbox, issue, evidence, and invitation loads with a 3×3 pixel wavefront, clear label, and elapsed time while keeping reduced-motion and screen-reader announcements stable.",
          "Replace the landing page's issue-to-completion demo with a new recording that reflects the current product flow.",
        ],
      },
      {
        version: "1.2.122",
        date: "August 14, 2026",
        title: "Clarify channel execution and streamline organization and Inbox navigation",
        summary:
          "Report unavailable Workers immediately, simplify organization and Inbox navigation, and refine Antigravity branding.",
        items: [
          "When an agent is mentioned in a channel, first verify an online, ready, work-accepting Worker with compatible provider, model, and effort capabilities; show a clear error immediately in desktop and Companion when none can run it.",
          "Open the organization list, current selection, and add-organization action directly from the sidebar organization name so switching organizations takes fewer steps.",
          "Replace labeled Inbox category filters with accessible icon buttons and count badges so filters remain readable beside the project selector without truncation.",
          "Use the bundled Antigravity provider artwork consistently across agent pickers and status surfaces.",
        ],
      },
      {
        version: "1.2.121",
        date: "August 14, 2026",
        title: "Connect Antigravity and clarify workflow creation",
        summary:
          "Add Google Antigravity as an agent provider and replace internal workflow-generation data with a clear, human-readable progress state.",
        items: [
          "Install, sign in to, and enable the Google Antigravity CLI from onboarding or App Settings, discover its live models and effort levels, and select it for issues, project and organization agents, and Worker dispatches.",
          "Bundle the Antigravity runner with desktop and the Briar CLI so new and resumed conversations, tool activity, attachments, approvals, sandboxing, and network policy use the same execution flow as other providers.",
          "Detect Antigravity authentication, health, and exhausted usage, then connect its actual model, token usage, and estimated cost to Google pricing in settings and usage views.",
          "Show a localized progress message while workflow creation and tool analysis finalize instead of exposing internal completion, execution, stages, and version JSON.",
        ],
      },
      {
        version: "1.2.120",
        date: "August 14, 2026",
        title: "Connect live conversations and agent execution more precisely",
        summary:
          "Dispatch work with capabilities providers actually support, while improving channel sync, result review, mobile history navigation, and Worker execution reliability.",
        items: [
          "Discover available models and model-specific effort levels from the Codex, Claude, Grok, and OpenCode CLIs, report them from each Worker, use the same choices across desktop, mobile, and iOS, and validate explicit dispatches against live capabilities.",
          "Share one organization-level WebSocket across channels, project conversations, and Inbox; apply Inbox changes immediately while recovering missed events through a transactional outbox and a 60-second fallback.",
          "Use channel Inbox events as message-sync signals so replies appear before their notifications, suppress only alerts for the channel currently in view, and schedule a follow-up sync when updates arrive during loading.",
          "Show evidence screenshots from the latest passing revision directly inside completed and review-pending result reports, without requiring a trip to the separate evidence tab.",
          "Show configured agent avatars alongside people in channel mention suggestions, with a consistent Bot fallback when an agent has no image.",
          "Serialize duplicate Worker claims for the same issue run and isolate session directories per execution attempt, preventing rework cleanup from deleting a new run or leaving a stale provider turn active.",
          "Open iOS and Android channels at the latest 20 root messages, load older history when scrolling upward, preserve the reader's position, and still jump directly to old notification messages.",
        ],
      },
      {
        version: "1.2.119",
        date: "August 14, 2026",
        title: "Make conversations and agent settings clearer",
        summary:
          "Read and compose issue and channel conversations more naturally, with more reliable Inbox, agent settings, and run-cost presentation.",
        items: [
          "Turn native iOS issue conversations into a channel-style timeline with date separators, avatars, authors, and timestamps, while keeping a keyboard-ready bottom composer plus Markdown, replies, mentions, and image attachments.",
          "Refresh the shared iOS and Android channel header with participant context and a capsule treatment, combine attachment, text, and send controls into one continuous composer, and support reduced-transparency and high-contrast environments.",
          "Keep the sidebar, headers, and composer visible when opening a channel thread reply from Inbox, centering only the requested reply inside the detail pane's conversation scroller.",
          "Create project agents without skills and remove the final skill safely, show guidance when execution needs a skill, and clamp long responsibility descriptions to six readable lines.",
          "Show the provider's actual model and estimated cost for provider-default runs, mapping Grok build variants to compatible base-model pricing.",
          "Correct Provider, Model, and Effort menu placement in the Create Agent modal, restore channel list markers and mention spacing, and add project badges to Inbox notification icons.",
        ],
      },
      {
        version: "1.2.118",
        date: "August 13, 2026",
        title: "Connect agent names and work screens more naturally",
        summary:
          "Use real agent names for channel mentions and make issue navigation, Inbox, model selection, and usage accounting more precise.",
        items: [
          "Mention agents by their exact names—including spaces and non-Latin characters—instead of separate handles, route with structured agent IDs, and avoid linking duplicate names to the wrong profile.",
          "Use ⌘[ and ⌘] to move through the issue list and visited issue details in order, while long results and conversations scroll correctly inside the Inbox detail pane.",
          "Keep model menus inside their modal boundary so long OpenCode catalogs can be searched and scrolled from Process now and other dialogs.",
          "Show the active agent reply state above the open channel thread composer while preserving inline status for other messages.",
          "Aggregate every Codex model call in a turn from cumulative snapshots, avoiding double counting across resumed conversations while recording tokens and estimated cost accurately.",
          "Connect the project and account toolbar to the native iOS Agents screen and complete mobile release validation for the latest TestFlight build.",
        ],
      },
      {
        version: "1.2.117",
        date: "August 13, 2026",
        title: "Connect channels and Inbox more clearly and precisely",
        summary:
          "Refine channel presentation and Inbox navigation while clarifying the Developer agent's role and making long work logs and provider usage handling more resilient.",
        items: [
          "Remove the duplicate Home child from the project sidebar so the project name itself opens home and reflects the active location.",
          "Show configured agent avatars in channel messages across desktop, mobile, and iOS, and improve mention spacing plus Markdown readability for links, inline code, code blocks, lists, quotes, and tables.",
          "Open desktop Inbox channel alerts in the right detail pane at the correct root message or thread, and route mobile and iOS issue-conversation alerts to the proper conversation tab while preserving message identifiers and read state.",
          "Measure the complete serialized work-log request, split and resend HTTP 413 batches in order, and keep optional transcript telemetry failures from failing the agent run itself.",
          "Detect exhausted OpenCode free usage even when action metadata is absent, and let the Worker accept provider exhaustion state and maximum usage percentage when deciding whether registration is blocked.",
          "Update the default Developer agent responsibility to own implementation, validation, and delivery—not only planning—and migrate agents that still use the previous default wording.",
        ],
      },
      {
        version: "1.2.116",
        date: "August 13, 2026",
        title: "Preserve long agent work logs more reliably",
        summary:
          "Separate raw provider events from the compact visible work log so long outputs retain their final reply and terminal state.",
        items: [
          "Store raw Codex, Claude, Grok, and OpenCode events as immutable compressed R2 segments while projecting only messages and activities into a compact D1 work log, preventing high-volume output from exhausting a session limit.",
          "Retry failed uploads up to three times in order, make identical segment retries safe, and surface a final failure instead of silently discarding the batch.",
          "Close unmatched writing entries as interrupted when a provider terminates without a completion event, so finished sessions no longer keep a running indicator.",
          "Allow authorized users to list and download compressed raw segments. This storage cutover resets pre-deployment work-log history and queues legacy raw archives for asynchronous deletion.",
        ],
      },
      {
        version: "1.2.115",
        date: "August 13, 2026",
        title: "Navigate work, conversations, and model choices more clearly",
        summary:
          "Scan unread conversations and Inbox faster while handling kanban columns, model selection, agent image replies, and error diagnostics more precisely.",
        items: [
          "Bold unread channel names and synchronize read state across desktop, mobile, and iOS, while automatically subscribing issue creators, conversation participants, and mentioned organization members.",
          "Split desktop Inbox into resizable list and detail panes, and move unneeded kanban columns into a right-side Hidden columns list that can restore them later.",
          "Use one provider-supported model catalog across issue, project, organization, and agent settings, with searchable OpenCode choices and preserved defaults and legacy models.",
          "Let Channel Agents attach workspace screenshots and images to replies within safe path and attachment limits.",
          "Add separate Y-axis scales for completed issues and tokens in Work analytics, and keep loading spinners centered on their circle origin.",
          "Deduplicate repeated error toasts and copy a sanitized diagnostic report with time, app version, request, status, environment, and stack details.",
        ],
      },
      {
        version: "1.2.114",
        date: "August 13, 2026",
        title: "Dispatch work with models supported by each provider",
        summary:
          "Worker dispatch now uses the models each provider actually reports, so newly supported models can be selected and run immediately.",
        items: [
          "Opening Assign Worker loads the current model catalog for Codex, Claude, Grok, and OpenCode and uses it for each provider's model picker.",
          "The catalog is requested once per app session and shared by settings and dispatch, with the built-in model list retained as a safe fallback.",
          "The server accepts provider-reported model IDs for dispatch while keeping the stricter validation rules for saved issue execution defaults.",
        ],
      },
      {
        version: "1.2.113",
        date: "August 13, 2026",
        title: "See issue conversations and run results faster and more clearly",
        summary:
          "Synchronize issue conversations in realtime and make agent work logs, estimated API costs, and available app updates easier to understand at a glance.",
        items: [
          "Share one organization WebSocket connection across channels and issue conversations, then apply project cursor deltas so agent replies and proposal states update without polling.",
          "Use one work-log view for issues and Project Agent sessions, separate initial and follow-up requests into clear cards, and keep export and automatic scrolling consistent.",
          "Combine the actual token ledger with current pricing to show estimated API cost by run and model, input and output rates, and the price-check timestamp.",
          "Emphasize the download button when a new app version is available, pause the effect during hover or installation, and respect reduced-motion preferences.",
          "Refresh landing-page sharing with a Briar-branded social card featuring the task board and updated product message.",
        ],
      },
      {
        version: "1.2.112",
        date: "August 12, 2026",
        title: "Make desktop settings and channel operations easier to follow",
        summary:
          "Stabilize macOS settings, update, and secure-input behavior while expanding channel history, Worker status, and public documentation.",
        items: [
          "Open Settings and update checks directly from the macOS app menu, with the update item changing its label when a new version is available.",
          "Release password-editor secure input when the macOS window loses focus so keyboard capture does not remain active in another app.",
          "Let Briar CLI and Project Agents page through authorized channel history and threads while the Worker enforces project-agent channel access.",
          "Add Worker status refresh, HTTPS profile avatars, issue-creator attribution, and public API and LLM docs so operations and automation have clearer context.",
        ],
      },
      {
        version: "1.2.111",
        date: "August 12, 2026",
        title: "Connect channel automation and see project health more clearly",
        summary:
          "Connect external events to channels while making project health, approval context, and desktop notification navigation easier to follow.",
        items: [
          "Create channel-scoped incoming webhooks, rename, rotate, or revoke them, while showing each secret only once and preventing duplicate events or excessive requests.",
          "Review period-based usage and execution ownership in Project Home, and collapse or expand kanban stage columns per user to scan a large board faster.",
          "Keep the original conversation context when approving issue execution from a channel, and move a thread to its newest reply after sending.",
          "Open a macOS notification directly at the related channel message and thread so the work can continue in the same context.",
        ],
      },
      {
        version: "1.2.110",
        date: "August 12, 2026",
        title: "Subscribe to issues and load project health faster",
        summary:
          "Control which issues notify you while Project Home and the channel composer respond more efficiently to the data and text that matter.",
        items: [
          "Subscribe or unsubscribe from an issue conversation and see current subscriber avatars, while assignees remain subscribed so they cannot miss important changes.",
          "Deliver issue status and conversation notifications only to subscribers across Inbox and system notifications, with the same subscription state on desktop, Android, and iOS.",
          "Aggregate and cache the last 30 days of project usage in D1 so Project Home no longer scans organization-wide execution history on every load.",
          "Grow the channel composer with explicit and automatic line wrapping up to 140px, then preserve internal scrolling for longer messages.",
        ],
      },
      {
        version: "1.2.109",
        date: "August 12, 2026",
        title: "Choose agent handles and restore realtime channel connections",
        summary:
          "Manage the @handles used to call Project Agents in channels, while packaged desktop and Android clients use the authenticated realtime channel connection.",
        items: [
          "Set a memorable @handle when creating or configuring a Project Agent and see the name-derived default immediately.",
          "Keep handles unique within the organization with safe suffixes and resilient fallback behavior for non-Latin names, long values, and concurrent creation.",
          "Validate handle reservation and updates in the Worker so channel mentions continue to resolve to the intended agent.",
          "Allow only the Briar API WSS origin in desktop and Android security policy so channel changes arrive in realtime instead of falling back to periodic polling.",
        ],
      },
      {
        version: "1.2.108",
        date: "August 12, 2026",
        title: "See project health and agent synchronization at a glance",
        summary:
          "Review recent project activity and execution health in a project lobby while keeping Inbox, Worker, and channel synchronization focused on data that actually changed.",
        items: [
          "Show the last 30 days of usage, execution time, issue status, GitHub connection state, and recent activity in one project lobby.",
          "Skip unchanged organization Inbox snapshots and Worker claim polls so synchronization avoids redundant responses and queries.",
          "Batch Worker lease renewals and credential-usage writes, and let idle channel realtime connections hibernate to reduce operational overhead.",
          "Batch long agent transcript writes and align the mention-composer caret to make execution history and conversation editing more reliable.",
        ],
      },
      {
        version: "1.2.107",
        date: "August 12, 2026",
        title: "Refine mobile channels and stop repeated session alerts",
        summary:
          "Restore native mobile channel navigation and composition while stabilizing Inbox synchronization so the same agent session does not notify more than once.",
        items: [
          "Use the system navigation bar and back behavior in iOS channel detail, with native message input, attachment, and send controls.",
          "Give the shared Android channel view a transparent mobile layout, consistent buttons, and ordered back navigation from thread to channel to channel list.",
          "Share one canonical Inbox version for completed and failed agent sessions across desktop and the Worker so equivalent state cannot retrigger OS notifications.",
          "Migrate existing D1 session summaries and account read state to the canonical version while keeping sessions that were already read marked as read.",
          "Describe Briar accurately as cloud-coordinated with local repository access and agent execution.",
        ],
      },
      {
        version: "1.2.106",
        date: "August 12, 2026",
        title: "Keep every Inbox notification visible across projects",
        summary:
          "Collect issue, conversation, channel, and agent notifications from every accessible project in the organization, regardless of which project is selected.",
        items: [
          "Aggregate issue state, replies and mentions, channel notifications, and agent sessions from every project into an authenticated organization Inbox feed.",
          "Merge selected-project details with the organization feed in the shared desktop and Android app, refreshing every 15 seconds while in the foreground.",
          "Align read versions with completion events and establish an initial-sync baseline so historical notifications do not fire all at once.",
          "Use the same organization Inbox model and foreground synchronization flow in the iOS Companion.",
        ],
      },
      {
        version: "1.2.105",
        date: "August 11, 2026",
        title: "Let project conversation agents verify work in a real runtime",
        summary:
          "Give Project Agents in channels and issues the same execution profile as project Workers so they can run development servers, browser automation, and local verification directly.",
        items: [
          "Run project-channel and issue-conversation agents with the same shell, network, browser, filesystem, and environment settings as project Workers.",
          "Copy `.worktreeinclude` inputs into fresh conversation workspaces so required gitignored runtime files are available safely.",
          "Keep every conversation isolated in a disposable worktree whose local changes are discarded after the reply finishes.",
          "Preserve the existing authenticated confirmation flow for Briar issue mutations and execution proposals.",
        ],
      },
      {
        version: "1.2.104",
        date: "August 11, 2026",
        title: "Make real-time collaboration and agent sync lighter and more precise",
        summary:
          "Fetch only the channel, agent, and dashboard changes that matter so conversations and run state stay fast and accurate as organizations grow.",
        items: [
          "Receive channel change notifications over SSE, drain only new records from the delta API, and recover missed updates with a periodic fallback sync.",
          "Synchronize Project Agent sessions through lightweight summaries and cursor deltas, loading full logs and archived results only when a session opens.",
          "Let Organization Agents request only the project settings, Agents, Skills, issues, pull requests, and sessions needed for a question within their authorized scope.",
          "Fetch all running work for the macOS status tray with one organization query, while dashboard deltas load relations only for changed runs.",
          "Apply D1 migrations before every Worker deployment, then skip redundant schema probes from recurring claim requests once the deployment baseline is established.",
          "Mark replies and status notifications read together when they are viewed in issue detail, without clearing unrelated Inbox items.",
          "Retain the last assigned Worker on completed issues so the execution owner remains visible in details and result metrics.",
        ],
      },
      {
        version: "1.2.103",
        date: "August 11, 2026",
        title: "Roll out Project Agent execution approvals safely",
        summary:
          "Protect natural-language Project Agent Skill requests with explicit approval, while making the production migration and conversation context more reliable.",
        items: [
          "Turn conversational Project Agent Skill requests into read-only proposals, then confirm the exact task and Worker before execution.",
          "Preserve the approved agent, Skill, request, and Worker in an audit record, and reject unapproved or stale execution attempts on the server.",
          "Use Wrangler-compatible trigger syntax and D1 statement boundaries so channel-agent delegation applies safely in production.",
          "Render connected people and agent mentions as recognizable, clickable buttons inside messages.",
          "Keep conversation images loaded after refresh and hide reply links when no real thread exists.",
          "Simplify issue header properties and action menus, and refine assignment badges so important state and actions are easier to find.",
        ],
      },
      {
        version: "1.2.100",
        date: "August 11, 2026",
        title: "Make conversational issues and agent collaboration safer",
        summary:
          "Protect conversational issue creation and execution with explicit approval, give Organization Agents controlled project context, and make desktop and iOS collaboration more consistent.",
        items: [
          "Review and approve issue proposals and executions from channel conversations, with the same state handling in Inbox and on mobile.",
          "Let Organization Agents delegate a narrowly scoped, read-only project question to the exact Project Agent while keeping authority and execution state separate.",
          "Synchronize desktop and iOS Inbox read state across focus, foreground, retries, and account changes so stale unread indicators are less likely.",
          "Preview attachments inline while editing issues and approve pending issue proposals directly from the Inbox side panel.",
          "Localize the native iOS Companion in Korean and English, and make session notifications and execution logs more precise.",
        ],
      },
      {
        version: "1.2.99",
        date: "August 10, 2026",
        title: "Handle concurrent runs and long conversations more reliably",
        summary:
          "Start multiple tasks from the same project agent at once, while keeping long links, code, and tables inside the issue conversation pane.",
        items: [
          "Start another Skill task from a project agent while an earlier task is still running.",
          "Track concurrent tasks as separate sessions so each run's progress and result remain independent.",
          "Wrap long URLs and content, and scroll code blocks or Markdown tables inside the issue conversation pane instead of expanding the page horizontally.",
        ],
      },
      {
        version: "1.2.98",
        date: "August 10, 2026",
        title: "See conversations and run status more clearly",
        summary:
          "Reply participants, real execution states, and inline issue editing are easier to see, while emoji positioning and optional agent authentication failures are handled more safely.",
        items: [
          "Summarize the people who participated in a conversation reply so its context is visible at a glance.",
          "Edit issue content inline and show the actual execution state in notification titles.",
          "Keep the channel emoji picker within the viewport instead of letting it open off-screen.",
          "Isolate optional MCP authentication failures so they do not turn into a full agent-run failure.",
          "Remove the duplicate loading spinner from the iOS task view.",
        ],
      },
      {
        version: "1.2.97",
        date: "August 10, 2026",
        title: "React to channel messages with any emoji",
        summary:
          "Use quick reactions or the full emoji picker in channel conversations, with the same synchronized reactions across desktop, Companion, and iOS.",
        items: [
          "Hover over a message to add a quick 👍, ❤️, 😂, or 🎉 reaction, or choose any reaction from the full emoji picker.",
          "See participant counts and your own state on reaction chips, then select the same emoji again to remove your reaction.",
          "Propagate reaction additions and removals through channel delta sync so message state stays current across devices.",
          "Use the same reaction model and toggle behavior on desktop, Companion web, and iOS Companion.",
        ],
      },
      {
        version: "1.2.96",
        date: "August 10, 2026",
        title: "Operate with clearer run costs and worker health",
        summary:
          "The execution ledger now powers the operating views, while runs without provider-reported cost are priced from current rates for a clearer picture of usage and spend by worker.",
        items: [
          "Aggregate ledger tokens and provider-reported cost by worker, provider, and model in the usage settings view.",
          "Estimate runs that do not report cost from the current model price table so operating totals include previously uncovered usage.",
          "See each Worker's installed Briar version and update availability in the environment panel, then request a remote update directly.",
          "Enable Full Auto when creating an issue to skip every checkpoint and run without pausing, with matching behavior on desktop and iOS.",
          "Open a channel-reply Inbox notification on the Channels page at the exact conversation that produced it.",
          "Close the project-agent task dialog immediately after dispatch so the interface proceeds to the run without inviting duplicate requests.",
        ],
      },
      {
        version: "1.2.95",
        date: "August 10, 2026",
        title: "See agent usage and cost for every run",
        summary:
          "Token usage and provider-reported costs from Codex, Claude, Grok, and OpenCode are now recorded on the server for clearer worker health and operating-cost visibility.",
        items: [
          "Persist input, output, cache, and reasoning tokens plus provider-reported cost in a durable ledger for each execution.",
          "Collect OpenCode and Grok usage alongside Codex and Claude, and stop advertising providers whose usage allowance is exhausted.",
          "Select an agent skill explicitly for direct runs, schedules, and issue processing so each job keeps the intended configuration.",
          "Change issue status and priority directly from their badges, while agent failures appear as unobtrusive toasts instead of blocking banners.",
          "Stabilize collaboration by sharing attachment handling, mention composition, pane resizing, and mobile presentation behavior across surfaces.",
        ],
      },
      {
        version: "1.2.94",
        date: "August 10, 2026",
        title: "Every agent now reports work through one consistent flow",
        summary:
          "Progress events from Codex, Claude, Grok, and OpenCode now share one format, making messages and tool activity more consistent and reliable.",
        items: [
          "Process message start, progress, completion, and final turn status through the same event flow across providers.",
          "Present command runs, file changes, web searches, and other tools with common start, output, and completion states.",
          "Qualify restored worker activity IDs by session so progress from concurrent runs cannot collide.",
          "Bound unusually large activity titles and output on safe UTF-8 boundaries to keep live execution views responsive.",
        ],
      },
      {
        version: "1.2.93",
        date: "August 10, 2026",
        title: "Give every agent the right skill for each job",
        summary:
          "Configure purpose-built skills on one agent, then select the right skill for direct runs, schedules, issue processing, and channel conversations.",
        items: [
          "Create multiple skills for project and organization agents, each with its own name, instructions, provider, model, and reasoning effort.",
          "Choose a skill for every direct agent run, while issue processing uses its dedicated skill and schedules see the agent's full skill roster.",
          "Mention an agent and a saved skill name in a channel to invoke that skill; unmatched requests stay within the agent's responsibility and full skill roster.",
          "Queued and running work keeps a durable reference to its selected skill, preserving execution context across renames and edits.",
        ],
      },
      {
        version: "1.2.92",
        date: "August 9, 2026",
        title: "Agent work can continue, with clearer usage visibility",
        summary:
          "Follow-up requests can now continue from completed agent sessions, while usage reporting and attachment delivery are more consistent.",
        items: [
          "Start follow-up work from a completed project-agent session while keeping the same conversation and workspace.",
          "Review agent usage in greater detail from the usage dashboard in Settings.",
          "Supported agent execution paths now hand off conversation attachments consistently, making image and file inputs more reliable.",
          "The iOS project menu remains available at accessibility text sizes, with improved channel-message image attachments.",
        ],
      },
      {
        version: "1.2.91",
        date: "August 8, 2026",
        title: "Inbox notifications now focus on moments that matter",
        summary:
          "Routine in-progress changes no longer crowd the Inbox, while agent execution links and kanban card details are more accurate across clients.",
        items: [
          "Backlog, queued, running, and workflow-stage changes no longer create new Inbox messages or notifications.",
          "The Inbox surfaces only paused, completed, failed, and blocked runs that need attention or mark an outcome.",
          "Desktop and iOS send agent execution IDs in the same lowercase format for reliable task dispatch.",
          "Kanban cards once again show assigned worker avatars and omit the redundant workflow-stage icon.",
        ],
      },
      {
        version: "1.2.90",
        date: "August 8, 2026",
        title: "Workflows and agent runs keep moving reliably",
        summary:
          "Workflow checkpoints now follow one v2 contract, while agent tasks and threaded replies stay connected through longer-running work.",
        items: [
          "Standardized project and run workflows on the canonical v2 checkpoint model for consistent approval and resume behavior.",
          "Active agent runs continue in the same conversation and worktree when the provider needs more than one turn to finish.",
          "Agent task claim routes are matched exactly and handled before static assets so workers can claim work reliably.",
          "Desktop and iOS threaded replies use the canonical stored message ID, keeping agent responses attached to the right conversation.",
          "Corrected issue source indicators and worker badges on kanban cards for more accurate execution context.",
        ],
      },
      {
        version: "1.2.89",
        date: "August 8, 2026",
        title: "Agent sessions now reflect the real outcome",
        summary:
          "Saved agents treat their responsibility as an outcome to complete, while session status now stays aligned with the structured execution result.",
        items: [
          "Pass each saved agent's responsibility as an explicit execution objective instead of a role description.",
          "Agents handle reasonable prerequisites and recovery work themselves, then verify the result before reporting completion.",
          "Both immediate and scheduled runs mark a session complete only when the structured outcome is completed.",
          "Partial, blocked, failed, or missing outcomes no longer appear as successful sessions, making execution history more reliable.",
        ],
      },
      {
        version: "1.2.88",
        date: "August 8, 2026",
        title: "Run agents on the worker you choose",
        summary:
          "Run saved agents against the latest code on a selected worker, with more reliable progress and result tracking across desktop and iOS.",
        items: [
          "Run saved-agent tasks on a selected worker, with every run starting in a fresh worktree from the latest main branch.",
          "Track project-agent task jobs on the server so execution state and results stay synchronized.",
          "Run project agents from iOS and follow their progress and results.",
          "Improved channel notifications, mention links, issue autocomplete, message sending, and the channel detail header.",
          "Redesigned the landing site around one light theme with explicit English and Korean routes.",
        ],
      },
      {
        version: "1.2.87",
        date: "August 7, 2026",
        title: "Organization agents and channel execution, connected",
        summary:
          "Manage organization-level agents directly and carry mentions and issue proposals through smoother desktop and mobile channel workflows.",
        items: [
          "Create, review, and delete organization agents that are not tied to a repository.",
          "Choose each agent's provider, model, reasoning effort, and responsibility when creating it.",
          "Typing @ in a channel once again shows the complete roster of people and agents.",
          "Approve channel issue proposals on mobile web and iOS, select a project, and open the resulting issue directly.",
          "Updated the landing product preview with a demo video of the real Briar workflow.",
        ],
      },
      {
        version: "1.2.86",
        date: "August 7, 2026",
        title: "Clearer connections between people and workers",
        summary:
          "Profiles and mentions now carry richer context, while remote worker updates and desktop quitting are safer and more deliberate.",
        items: [
          "Open profiles from channel mentions to see a person or agent's name, role, and activity context.",
          "Check remote organization worker update status and apply new versions more safely.",
          "Confirm before quitting with Cmd+Q to avoid closing active work by mistake.",
          "Removed the redundant source-dot icon from issue card badges for cleaner status information.",
        ],
      },
      {
        version: "1.2.85",
        date: "August 7, 2026",
        title: "Richer collaboration in channels",
        summary:
          "Channels now bring images, invitations, message controls, and planning documents into one connected collaboration flow.",
        items: [
          "Attach images to channel messages and pass them into agent vision input.",
          "Invite members to channels and edit or delete channel messages.",
          "Plans have moved from Ideas into channel documents, keeping discussion and execution together.",
          "Improved issue image editing, error toasts, and assignee and worker controls.",
          "Briar is now available under the Apache License 2.0.",
        ],
      },
      {
        version: "1.2.84",
        date: "August 7, 2026",
        title: "A redesigned desktop channel conversation",
        summary:
          "The channel list and conversation thread now use a clearer hierarchy so teams can understand active discussions faster.",
        items: [
          "Redesigned the structure and visual hierarchy of desktop channel conversations.",
          "Made it easier to follow conversations across channel and project context.",
        ],
      },
      {
        version: "1.2.83",
        date: "August 7, 2026",
        title: "Faster, more precise mentions",
        summary:
          "Finding and selecting the right person or agent in a channel is now more direct.",
        items: [
          "Improved navigation and selection in the channel mention picker.",
          "Clarified the fastest pre-PR verification path in the documentation.",
        ],
      },
      {
        version: "1.2.82",
        date: "August 7, 2026",
        title: "Cleaner mobile issue identifiers",
        summary:
          "Issue numbers and state are easier to scan on smaller screens with redundant formatting removed.",
        items: [
          "Removed thousands separators from mobile issue keys.",
          "Removed the duplicate stage icon beside issue keys for a cleaner list.",
        ],
      },
      {
        version: "1.2.81",
        date: "August 7, 2026",
        title: "More reliable issue creation and project sync",
        summary:
          "Language-aware title rules, project selection, and startup synchronization now behave consistently.",
        items: [
          "Apply issue title limits that account for the writing language.",
          "Preselect the project that opened the new issue dialog.",
          "Synchronize local project workflows when the app starts.",
        ],
      },
      {
        version: "1.2.80",
        date: "August 7, 2026",
        title: "Roomier channel views across mobile and desktop",
        summary:
          "Channel conversations now adapt more naturally to each screen size, with improved layout and build compatibility.",
        items: [
          "Improved mobile channel navigation and message layout.",
          "Let the desktop channel UI fill the available shell width.",
          "Restored iOS channel build compatibility.",
        ],
      },
    ],
  },
} as const satisfies Record<Locale, unknown>;

const PATH = "/changelog" as const;

export default function ChangelogView({ locale }: { locale: Locale }) {
  const c = copy[locale];
  const changelog = changelogCopy[locale];
  const hrefs = {
    en: localizedPath("en", PATH),
    ko: localizedPath("ko", PATH),
  } as const;

  return (
    <main className="changelog-page" id="top">
      <SiteHeader
        brandHref={localizedPath(locale, "/")}
        className="changelog-header"
        copy={c}
        ctaLabel={changelog.openApp}
        currentPath={PATH}
        hrefs={hrefs}
        locale={locale}
        mobileCtaLabel={c.nav.openWebApp}
      />

      <section className="changelog-hero shell">
        <div>
          <span className="section-index">{changelog.eyebrow}</span>
          <h1>{changelog.title}</h1>
          <p>{changelog.description}</p>
        </div>
        <a href="#v1-2-128" className="changelog-current">
          <span>{changelog.current}</span>
          <strong>v1.2.128</strong>
          <i aria-hidden="true">↓</i>
        </a>
      </section>

      <section className="changelog-list shell" aria-label={changelog.title}>
        {changelog.entries.map((entry, index) => {
          const tagUrl = `${GITHUB_RELEASES_URL}/tag/v${entry.version}`;
          const entryId = `v${entry.version.replaceAll(".", "-")}`;
          return (
            <article
              className={`changelog-entry${index === 0 ? " is-latest" : ""}`}
              id={entryId}
              key={entry.version}
            >
              <div className="changelog-entry-index" aria-hidden="true">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <i />
              </div>
              <div className="changelog-entry-body">
                <div className="changelog-entry-meta">
                  <strong>v{entry.version}</strong>
                  {index === 0 ? <span>{changelog.latest}</span> : null}
                  <time
                    dateTime={
                      entry.version === "1.2.128" ||
                      entry.version === "1.2.127" ||
                      entry.version === "1.2.126" ||
                      entry.version === "1.2.125" ||
                      entry.version === "1.2.124"
                        ? entry.version === "1.2.128" ||
                          entry.version === "1.2.127"
                          ? "2026-08-16"
                          : "2026-08-15"
                        : entry.version === "1.2.123" ||
                      entry.version === "1.2.122" ||
                      entry.version === "1.2.121" ||
                      entry.version === "1.2.120" ||
                      entry.version === "1.2.119"
                        ? "2026-08-14"
                        : entry.version === "1.2.118" ||
                      entry.version === "1.2.117" ||
                      entry.version === "1.2.116" ||
                      entry.version === "1.2.115" ||
                      entry.version === "1.2.114"
                        ? "2026-08-13"
                        : entry.version === "1.2.112" ||
                            entry.version === "1.2.111" ||
                            entry.version === "1.2.110" ||
                            entry.version === "1.2.109" ||
                            entry.version === "1.2.108" ||
                            entry.version === "1.2.107" ||
                            entry.version === "1.2.106"
                          ? "2026-08-12"
                        : entry.version === "1.2.105" ||
                            entry.version === "1.2.104" ||
                            entry.version === "1.2.103" ||
                            entry.version === "1.2.100" ||
                            entry.version === "1.2.99" ||
                            entry.version === "1.2.98" ||
                            entry.version === "1.2.97" ||
                            entry.version === "1.2.96" ||
                            entry.version === "1.2.95" ||
                            entry.version === "1.2.94" ||
                            entry.version === "1.2.93" ||
                            entry.version === "1.2.92" ||
                            entry.version === "1.2.91" ||
                            entry.version === "1.2.90" ||
                            entry.version === "1.2.89" ||
                            entry.version === "1.2.88"
                          ? entry.version === "1.2.105" ||
                              entry.version === "1.2.104" ||
                              entry.version === "1.2.103" ||
                              entry.version === "1.2.100"
                            ? "2026-08-11"
                            : entry.version === "1.2.99" ||
                                entry.version === "1.2.98" ||
                                entry.version === "1.2.97" ||
                                entry.version === "1.2.96" ||
                                entry.version === "1.2.95" ||
                                entry.version === "1.2.94" ||
                                entry.version === "1.2.93"
                              ? "2026-08-10"
                              : entry.version === "1.2.92"
                                ? "2026-08-09"
                                : "2026-08-08"
                          : "2026-08-07"
                    }
                  >
                    {changelog.released} · {entry.date}
                  </time>
                </div>
                <h2>{entry.title}</h2>
                <p>{entry.summary}</p>
                <ul>
                  {entry.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <a href={tagUrl} target="_blank" rel="noreferrer">
                  {changelog.releaseNotes} <Arrow />
                </a>
              </div>
            </article>
          );
        })}
      </section>

      <section className="changelog-archive shell">
        <span className="section-index">RELEASE ARCHIVE</span>
        <a href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer">
          {changelog.allReleases} <Arrow />
        </a>
      </section>

      <SiteFooter
        brandHref={localizedPath(locale, "/")}
        copy={c}
        links={[
          { href: localizedPath(locale, "/"), label: changelog.home },
          { href: localizedPath(locale, "/tutorial"), label: c.nav.tutorial },
          { href: localizedPath(locale, "/download"), label: c.nav.download },
          { href: "#top", label: changelog.backTop },
        ]}
      />
    </main>
  );
}
