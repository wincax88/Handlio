import { renderToString } from "react-dom/server";
import { App } from "./App";
import { SourceFooter } from "./SourceFooter";
export { publicPaths } from "../shared/seo";

export function renderPage(path: string) {
  return renderToString(
    <>
      <App initialRoute={path} />
      <SourceFooter />
    </>,
  );
}
