# 로컬 실행 가이드

## 브라우저에서 바로 열기 (AI 기능 제외)

```bash
open index.html   # macOS
start index.html  # Windows
```

AI 기능 없이 기록/조회는 정상 동작합니다.

---

## AI 기능까지 사용하기 (로컬 프록시 필요)

브라우저에서 Anthropic API를 직접 호출하려면 API 키 노출 문제가 있어
간단한 로컬 프록시 서버를 통해 키를 안전하게 주입합니다.

### 준비물

- Node.js 18+
- Anthropic API 키 (`ANTHROPIC_API_KEY` 환경변수)

### 프록시 서버 실행

```bash
# 의존성 설치 (첫 실행 시 한 번만)
npm install express http-proxy-middleware cors

# .env 파일 생성
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# 프록시 서버 실행
node proxy.js
```

### proxy.js

```js
require('dotenv').config();
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
app.use(cors());

app.use('/v1', createProxyMiddleware({
  target: 'https://api.anthropic.com',
  changeOrigin: true,
  on: {
    proxyReq: (proxyReq) => {
      proxyReq.setHeader('x-api-key', process.env.ANTHROPIC_API_KEY);
      proxyReq.setHeader('anthropic-version', '2023-06-01');
    },
  },
}));

app.listen(3001, () => console.log('프록시 서버 실행 중: http://localhost:3001'));
```

### app.js API URL 수정

로컬 프록시 사용 시 `app.js`의 fetch URL을 변경합니다:

```js
// 기존 (claude.ai 아티팩트 환경)
const response = await fetch('https://api.anthropic.com/v1/messages', ...);

// 로컬 프록시 사용 시
const response = await fetch('http://localhost:3001/v1/messages', ...);
```

### 앱 실행

```bash
# 별도 터미널에서 정적 파일 서버
npx serve .
# → http://localhost:3000 에서 앱 실행
```

---

## 향후 배포 옵션

| 옵션 | 난이도 | 특징 |
|------|--------|------|
| GitHub Pages | 쉬움 | AI 기능 없이 기록만 |
| Vercel (Next.js로 이전) | 중간 | API Route로 키 안전 보관 |
| 자체 서버 (VPS) | 어려움 | 완전한 제어 |

학교 컴퓨터에서만 사용한다면 로컬 프록시 방식이 가장 간단합니다.
