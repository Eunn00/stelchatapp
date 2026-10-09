# StelChat Windows

StelChat의 공개 API와 SSE에 연결되는 Windows 미니 앱입니다. CHZZK 쿠키나 서버 비밀정보를 포함하지 않습니다.

실행 파일은 이 저장소의 GitHub Releases에서 배포합니다. 비공개 상태에서는 저장소 접근 권한이 있는 사용자만 다운로드할 수 있습니다.

## 개발 실행

```powershell
cd path\to\stelchatapp
npm install
npm start
```

창을 닫으면 종료되지 않고 시스템 트레이로 이동합니다. 완전히 종료하려면 트레이 아이콘의 `종료`를 누릅니다.

`바탕화면 모드`를 켜면 앱은 작업 표시줄에 계속 표시되면서 최소화되지 않고, 다른 일반 창에는 가려지는 데스크톱 위젯처럼 동작합니다. 마지막 창 위치와 크기는 다음 실행에도 유지됩니다.

## 휴대용 실행 파일 생성

```powershell
npm run dist
```

결과는 `release/StelChat-<version>-portable.exe`에 생성됩니다. 현재 실행 파일은 코드 서명이 없으므로 다른 PC에서는 Windows SmartScreen 경고가 표시될 수 있습니다.

## 오픈소스 라이선스

앱에 포함되거나 빌드에 사용되는 오픈소스 구성 요소와 라이선스 고지는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에서 확인할 수 있습니다. Electron이 제공하는 `LICENSE.electron.txt`와 `LICENSES.chromium.html`도 배포 파일에 포함됩니다.

## 설치 프로그램 생성

```powershell
npm run dist:installer
```

## 개인정보 처리방침

StelChat Windows 앱은 방문자를 개별적으로 추적하지 않으며, 앱에서 처리하는 정보를 필요한 범위 안에서 안내합니다. 이 방침은 [「개인정보 보호법」 제30조](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1025127653)의 공개 원칙을 참고해 작성했습니다.

### 1. 앱이 이용하는 정보

앱은 `https://stelchat.xyz`의 공개 API와 실시간 이벤트 스트림을 통해 STELLIVE 멤버의 공개 프로필, 공개 채팅 기록, 방송 제목과 진행 상태를 조회합니다. 앱에는 CHZZK 계정 쿠키, 액세스 토큰, 서버 비밀번호 또는 개발자의 개인 계정 정보가 포함되지 않습니다.

### 2. 사용자 개인정보

앱은 앱 이용자에 관한 회원가입 정보, 쿠키, 광고 식별자, 연락처, 위치 정보 또는 별도 입력 콘텐츠를 수집하거나 StelChat 서버로 전송하지 않습니다. API 통신 과정에서는 인터넷 연결에 필요한 IP 주소가 서버 또는 네트워크 사업자에 의해 일시적으로 처리될 수 있으나, StelChat의 애플리케이션 데이터베이스와 웹 접근 로그에는 저장하지 않습니다.

### 3. 기기에 저장되는 설정

창 위치와 크기, 투명도, 바탕화면 모드, Windows 시작 시 실행 여부, 멤버별 Windows·소리 알림 설정은 현재 PC의 `%APPDATA%\stelchat-desktop` 아래에 저장됩니다. 이 설정은 다른 PC와 동기화되지 않으며 StelChat 서버로 전송되지 않습니다. Electron 실행에 필요한 캐시 파일도 같은 앱 데이터 영역에 만들어질 수 있습니다.

휴대용 실행 파일은 Windows 작업표시줄과 알림에 StelChat 이름 및 아이콘을 연결하기 위해 시작 메뉴의 프로그램 폴더에 `StelChat.lnk` 바로가기 하나를 만듭니다. 바탕화면에는 바로가기를 만들지 않습니다.

앱과 로컬 설정을 완전히 삭제하려면 앱을 종료한 뒤 실행 파일, `%APPDATA%\stelchat-desktop` 폴더와 시작 메뉴의 `StelChat` 바로가기를 삭제하면 됩니다.

### 4. Windows 알림과 소리

Windows 알림을 켜면 선택한 멤버의 방송 시작 또는 새 채팅 내용이 현재 PC의 Windows 알림 기능으로 전달됩니다. 소리 알림은 앱 안에서 현재 PC의 오디오 장치를 통해 재생됩니다. 두 설정은 기본적으로 모두 꺼져 있으며 멤버와 이벤트 종류별로 직접 켤 수 있습니다.

### 5. 제3자 제공 및 분석

앱은 사용자 정보를 광고하거나 판매하지 않고, 광고 SDK나 별도의 이용자 분석 도구를 포함하지 않습니다. 데이터 조회를 위해 StelChat 서버와 통신하고, 최신 버전 확인을 위해 앱 실행 시 GitHub 공개 릴리스 API에 한 번 요청합니다. 이 요청에 앱이 수집한 사용자 정보는 포함하지 않습니다. 사용자가 CHZZK 바로가기를 누른 경우에만 기본 브라우저로 해당 CHZZK 라이브 페이지를 엽니다. StelChat은 NAVER 또는 CHZZK의 공식 서비스가 아닌 비공식·비영리 팬 프로젝트입니다.

### 6. 문의와 방침 변경

앱 또는 공개 기록에 관한 열람·정정·삭제 문의는 [StelChat 웹사이트](https://stelchat.xyz) 최하단의 **Contact**를 이용해 주세요. 처리 정보나 앱 동작 방식이 바뀌면 이 README에서 변경 내용을 공개합니다.

이 앱 개인정보 처리방침은 2026년 10월 7일부터 적용합니다.
