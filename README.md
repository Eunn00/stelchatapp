# StelChat Windows

StelChat의 공개 API와 SSE에 연결되는 Windows 미니 앱입니다. CHZZK 쿠키나 서버 비밀정보를 포함하지 않습니다.

실행 파일은 이 저장소의 GitHub Releases에서 배포합니다. 비공개 상태에서는 저장소 접근 권한이 있는 사용자만 다운로드할 수 있습니다.

## 개발 실행

```powershell
cd path\to\stetchatapp
npm install
npm start
```

창을 닫으면 종료되지 않고 시스템 트레이로 이동합니다. 완전히 종료하려면 트레이 아이콘의 `종료`를 누릅니다.

`바탕화면 모드`를 켜면 앱이 작업 표시줄에서 빠지고 최소화되지 않으며, 다른 일반 창에는 가려지는 데스크톱 위젯처럼 동작합니다. 마지막 창 위치와 크기는 다음 실행에도 유지됩니다.

## 휴대용 실행 파일 생성

```powershell
npm run dist
```

결과는 `release/StelChat-<version>-portable.exe`에 생성됩니다. 현재 실행 파일은 코드 서명이 없으므로 다른 PC에서는 Windows SmartScreen 경고가 표시될 수 있습니다.

## 설치 프로그램 생성

```powershell
npm run dist:installer
```
