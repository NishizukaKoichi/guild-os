import { RpcTarget, newMessagePortRpcSession, type RpcStub } from "capnweb";
import { createRoot } from "react-dom/client";
import type { GuildUiApi } from "../src/management-types";
import { App } from "./App";
import { installFormSubmitBridge } from "./form-submit-bridge";
import { I18nProvider } from "./i18n";
import "./styles.css";

class GuildIframe extends RpcTarget {}

interface HostCapability extends RpcTarget {
  readonly ui: RpcStub<GuildUiApi>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing Guild application root.");

installFormSubmitBridge(document);

function render(api: GuildUiApi) {
  createRoot(root!).render(
    <I18nProvider>
      <App api={api} />
    </I18nProvider>,
  );
}

async function main() {
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("standalone")) {
    const { createDevelopmentApi } = await import("./dev-api");
    render(createDevelopmentApi(new URLSearchParams(location.search).get("standalone") ?? "root"));
    return;
  }

  const { port1, port2 } = new MessageChannel();
  window.parent.postMessage({ type: "handshake" }, "*", [port2]);
  const host = newMessagePortRpcSession<HostCapability>(port1, new GuildIframe());
  render(host.ui);
}

void main();
