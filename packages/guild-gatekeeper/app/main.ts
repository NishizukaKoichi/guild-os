import { RpcTarget, newMessagePortRpcSession, type RpcStub } from "capnweb";
import "./styles.css";

class GuildIframe extends RpcTarget {}

interface HostCapability extends RpcTarget {
  readonly ui: RpcStub<RpcTarget>;
}

function requiredDatasetValue(key: keyof DOMStringMap): string {
  const value = document.body.dataset[key];
  if (!value) throw new Error(`Missing Guild page value: ${String(key)}`);
  return value;
}

const name = requiredDatasetValue("guildName");
const purpose = requiredDatasetValue("guildPurpose");
const membership = requiredDatasetValue("membershipState");

document.title = `${name} - Guild OS`;
document.querySelector("#guild-name")!.textContent = name;
document.querySelector("#guild-purpose")!.textContent = purpose;
document.querySelector("#membership-state")!.textContent = membership;

const { port1, port2 } = new MessageChannel();
window.parent.postMessage({ type: "handshake" }, "*", [port2]);
newMessagePortRpcSession<HostCapability>(port1, new GuildIframe());
