import { BlockList, isIP } from "node:net";

/** An IPv4 peer reached over a dual-stack socket appears as ::ffff:a.b.c.d; match it as IPv4. */
const unmap = (addr: string) => (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(addr) ? addr.slice(7) : addr);

/**
 * The addresses allowed to set the trusted identity header, parsed from a list of addresses and
 * CIDRs separated by commas or whitespace. Throws on an entry that is neither, so a typo fails
 * the boot instead of silently trusting nothing (or the wrong thing).
 */
export function parseTrustedProxies(raw: string): (addr: string) => boolean {
  const list = new BlockList();
  const entries = raw.split(/[\s,]+/).filter(Boolean);
  if (!entries.length) throw new Error("LORE_AUTH_TRUSTED_PROXIES lists no addresses");
  for (const entry of entries) {
    const [ip, bits, extra] = unmap(entry).split("/");
    const family = isIP(ip);
    const prefix = Number(bits);
    const max = family === 4 ? 32 : 128;
    if (!family || extra !== undefined || (bits !== undefined && !(/^\d+$/.test(bits) && prefix <= max))) {
      throw new Error(`LORE_AUTH_TRUSTED_PROXIES: '${entry}' is not an address or CIDR`);
    }
    const type = family === 4 ? "ipv4" : "ipv6";
    if (bits === undefined) list.addAddress(ip, type);
    else list.addSubnet(ip, prefix, type);
  }
  return (addr: string) => {
    const a = unmap(addr);
    const family = isIP(a);
    return family !== 0 && list.check(a, family === 4 ? "ipv4" : "ipv6");
  };
}
