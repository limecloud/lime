import { gzipSync } from "node:zlib";

// This creates only the small regular-file USTAR fixture consumed by the real installer.
export function remotePluginBundle(index, version = "1.0.0") {
  const entries = [
    [
      ".lime-plugin/plugin.json",
      JSON.stringify({
        name: `research-${index}`,
        version,
        skills: "./skills",
      }),
    ],
    [
      "skills/research-skill/SKILL.md",
      "---\nname: research-skill\ndescription: Research skill\n---\nResearch carefully.\n",
    ],
    [
      ".mcp.json",
      JSON.stringify({
        mcpServers: {
          "research-server": { command: "node", args: ["--version"] },
        },
      }),
    ],
  ];
  const blocks = [];
  for (const [name, contents] of entries) {
    const bytes = Buffer.from(contents);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "ascii");
    const octal = (value, offset, width) =>
      header.write(
        `${value.toString(8).padStart(width - 1, "0")}\0`,
        offset,
        width,
        "ascii",
      );
    octal(0o644, 100, 8);
    octal(0, 108, 8);
    octal(0, 116, 8);
    octal(bytes.length, 124, 12);
    octal(0, 136, 12);
    header.fill(0x20, 148, 156);
    header.write("0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(
      `${checksum.toString(8).padStart(6, "0")}\0 `,
      148,
      8,
      "ascii",
    );
    blocks.push(
      header,
      bytes,
      Buffer.alloc((512 - (bytes.length % 512)) % 512),
    );
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
