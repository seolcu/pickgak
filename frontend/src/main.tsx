import "./lib/migrateStorage"; // 다른 모듈이 저장값을 읽기 전에
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { OverlayApp } from "./features/live/OverlayApp";
import "./i18n";
import "./index.css";
import { startFresh } from "./lib/freshStart";

const overlay = new URLSearchParams(location.search).has("overlay");
// 새로 켰으면 지난 판을 비운다. 화면이 저장된 판을 읽기 전에 한다
if (!overlay) startFresh();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* 데스크톱 앱의 오버레이 창은 같은 화면 코드를 '?overlay=1'로 연다 */}
    {overlay ? <OverlayApp /> : <App />}
  </StrictMode>,
);
