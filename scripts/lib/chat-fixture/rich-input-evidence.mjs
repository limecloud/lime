import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  canonicalSkillProjection,
  isExpectedSkillIdentity,
} from "./skill-identity.mjs";
import {
  isObservedPreloadAppServerResponse,
  parseJsonRpcRequestsFromInvokeTrace,
} from "../../electron/lib/mcp-config-fixture-evidence.mjs";

export function richInputImageUrl(imageBase64) {
  const digest = createHash("sha256")
    .update(Buffer.from(imageBase64, "base64"))
    .digest("hex");
  return `sidecar://media/input-${digest}.png`;
}

function normalizeInputPart(part) {
  if (part?.type === "text") {
    return { ...part, text_elements: part.text_elements ?? [] };
  }
  if (part?.type === "image") return { ...part, detail: part.detail ?? null };
  return part;
}

export function summarizeRichInputSubmission({
  traceRaw,
  canonical,
  threadId,
  turnId,
  prompt,
  editorText,
  skillToken,
  skillIdentity,
  imageBase64,
  pathReference,
  mediaRead,
  pasteToken,
  pasteText,
  expectedSubmission,
}) {
  const expectedWireText = expectedSubmission?.text;
  let requests = [];
  try {
    requests = parseJsonRpcRequestsFromInvokeTrace(traceRaw);
  } catch {
    // Missing or malformed transport evidence fails closed.
  }
  const request = requests.findLast(
    (entry) =>
      entry.method === "turn/start" &&
      entry.params.threadId === threadId &&
      Array.isArray(entry.params.input) &&
      entry.params.input.some(
        (part) => part?.type === "text" && part.text === expectedWireText,
      ),
  );
  const transportObserved =
    request?.transport === "electron-ipc" &&
    request.status === "success" &&
    request.id != null;
  const input = request?.params.input ?? [];
  const textParts = input.filter((part) => part?.type === "text");
  const body = textParts.find((part) => part.text === expectedWireText);
  const textPreserved =
    typeof prompt === "string" &&
    prompt.length > 0 &&
    typeof editorText === "string" &&
    editorText.startsWith(prompt) &&
    typeof expectedWireText === "string" &&
    typeof skillIdentity?.name === "string" &&
    expectedWireText.startsWith(prompt) &&
    editorText === expectedSubmission?.displayText &&
    !!body;
  const pasteExpanded =
    pasteToken === undefined && pasteText === undefined
      ? true
      : typeof pasteText === "string" &&
        pasteText.length > 1_000 &&
        typeof editorText === "string" &&
        !!pasteToken?.id &&
        pasteToken.editable === "false" &&
        typeof pasteToken.label === "string" &&
        pasteToken.label.length > 0 &&
        editorText.split(pasteToken.label).length === 2 &&
        body?.text === expectedWireText &&
        body.text.includes(pasteText) &&
        !body.text.includes(pasteToken.label);
  const validSkillToken =
    !!skillToken &&
    [skillToken.name, skillToken.path, skillToken.label].every(
      (value) => typeof value === "string" && value.length > 0,
    ) &&
    skillToken.editable === "false" &&
    skillToken.id === skillIdentity?.key &&
    skillToken.label === `$${skillIdentity?.name}`;
  const skills = input.filter((part) => part?.type === "skill");
  const skillIdentityPreserved =
    validSkillToken &&
    skills.length === 1 &&
    isExpectedSkillIdentity(skillToken, skillIdentity) &&
    isExpectedSkillIdentity(skills[0], skillIdentity);
  const bytes = Buffer.from(body?.text ?? "", "utf8");
  const textElementsPreserved =
    Array.isArray(expectedSubmission?.textElements) &&
    isDeepStrictEqual(body?.text_elements, expectedSubmission.textElements) &&
    expectedSubmission.textElements.every((element) => {
      const { start, end } = element?.byteRange ?? {};
      const expectedSlice =
        element.placeholder === pasteToken?.label
          ? pasteText
          : element.placeholder;
      return (
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= 0 &&
        end > start &&
        end <= bytes.length &&
        typeof expectedSlice === "string" &&
        bytes.subarray(start, end).toString("utf8") === expectedSlice
      );
    });
  const pasteRangePreserved =
    pasteToken === undefined && pasteText === undefined
      ? true
      : Array.isArray(body?.text_elements) &&
        body.text_elements.filter(
          (element) => element.placeholder === pasteToken?.label,
        ).length === 1 &&
        body.text_elements.some(
          (element) =>
            element.placeholder === pasteToken?.label &&
            bytes
              .subarray(element.byteRange?.start, element.byteRange?.end)
              .toString("utf8") === pasteText,
        );
  const skillLink = validSkillToken
    ? `[${skillToken.label.replaceAll("\\", "\\\\").replaceAll("](", "]\\(").replaceAll("]", "\\]")}](${skillToken.path.replaceAll("\\", "\\\\").replaceAll(")", "\\)")})`
    : null;
  const skillLinkIndex = skillLink
    ? (expectedWireText?.indexOf(skillLink) ?? -1)
    : -1;
  const skillResourceLinkPreserved =
    validSkillToken &&
    skillLinkIndex >= 0 &&
    expectedWireText.indexOf(skillLink, skillLinkIndex + 1) < 0 &&
    Array.isArray(body?.text_elements) &&
    body.text_elements.every(
      (element) => element.placeholder !== skillToken.label,
    );
  const clientId = request?.params.clientUserMessageId;
  const canonicalTurnIdentityPreserved =
    typeof turnId === "string" &&
    turnId.length > 0 &&
    Array.isArray(canonical?.thread?.turns) &&
    canonical.thread.turns.some(
      (turn) =>
        turn.id === turnId &&
        Array.isArray(turn.items) &&
        turn.items.some(
          (item) => item.type === "userMessage" && item.clientId === clientId,
        ),
    );
  const users =
    canonical?.thread?.id === threadId && Array.isArray(canonical.thread.turns)
      ? canonical.thread.turns
          .flatMap((turn) => (Array.isArray(turn.items) ? turn.items : []))
          .filter(
            (item) =>
              item?.type === "userMessage" && item.clientId === clientId,
          )
      : [];
  const canonicalIdentityPreserved =
    typeof clientId === "string" &&
    clientId.length > 0 &&
    users.length === 1 &&
    typeof users[0].id === "string" &&
    users[0].id.length > 0;
  const content =
    canonicalIdentityPreserved && Array.isArray(users[0].content)
      ? users[0].content
      : [];
  const canonicalTextPreserved =
    textParts.length > 0 &&
    isDeepStrictEqual(
      content.filter((part) => part?.type === "text"),
      textParts,
    );
  let canonicalSkillPreserved = false;
  let normalizedContent;
  let normalizedInput;
  try {
    normalizedContent = canonicalSkillProjection(content, skillIdentity);
    normalizedInput = canonicalSkillProjection(input, skillIdentity);
    canonicalSkillPreserved =
      skillIdentityPreserved &&
      isDeepStrictEqual(
        normalizedContent.filter((part) => part?.type === "skill"),
        normalizedInput.filter((part) => part?.type === "skill"),
      );
  } catch {
    // Canonical readback must point to the same existing fixture Skill file.
  }
  const paths = input.filter((part) => part?.type === "mention");
  const pathIdentityPreserved =
    typeof pathReference?.name === "string" &&
    pathReference.name.length > 0 &&
    typeof pathReference.path === "string" &&
    pathReference.path.length > 0 &&
    paths.length === 1 &&
    paths[0].name === pathReference.name &&
    paths[0].path === pathReference.path;
  const expectedImage =
    typeof imageBase64 === "string" && imageBase64.length > 0
      ? Buffer.from(imageBase64, "base64")
      : Buffer.alloc(0);
  const imageUrl =
    expectedImage.length > 0 ? richInputImageUrl(imageBase64) : null;
  const images = input.filter((part) => part?.type === "image");
  const imageIdentityPreserved =
    expectedImage.length > 0 &&
    images.length === 1 &&
    images[0].url === `data:image/png;base64,${imageBase64}`;
  const expectedContent = normalizedInput?.map((part) =>
    normalizeInputPart(
      part?.type === "image" ? { ...part, url: imageUrl } : part,
    ),
  );
  const canonicalFullInputPreserved =
    textParts.length === 1 &&
    skills.length === 1 &&
    paths.length === 1 &&
    images.length === 1 &&
    input.length === 4 &&
    canonicalIdentityPreserved &&
    canonicalSkillPreserved &&
    isDeepStrictEqual(
      normalizedContent.map(normalizeInputPart),
      expectedContent,
    );
  const mediaReadObserved =
    isObservedPreloadAppServerResponse(
      mediaRead?.ipcObservation,
      "media/read",
    ) &&
    mediaRead.ipcObservation.params?.threadId === threadId &&
    mediaRead.ipcObservation.params?.uri === imageUrl;
  const media = mediaRead?.result;
  const canonicalImageBytesPreserved =
    expectedImage.length > 0 &&
    media?.threadId === threadId &&
    media.uri === imageUrl &&
    media.mimeType === "image/png" &&
    media.offset === 0 &&
    media.bytes === expectedImage.length &&
    media.totalBytes === expectedImage.length &&
    media.length === expectedImage.length &&
    media.hasMore === false &&
    typeof media.contentBase64 === "string" &&
    Buffer.from(media.contentBase64, "base64").equals(expectedImage);
  const checks = {
    inputOrderPreserved: isDeepStrictEqual(
      input.map((part) => part?.type),
      ["text", "skill", "mention", "image"],
    ),
    singleInputRequest:
      requests.filter(
        (entry) =>
          entry.params.threadId === threadId &&
          [
            "turn/start",
            "turn/steer",
            "thread/queue/add",
            "thread/queue/update",
            "thread/queue/start",
          ].includes(entry.method),
      ).length === 1,
    transportObserved,
    textPreserved,
    pasteExpanded,
    skillIdentityPreserved,
    skillResourceLinkPreserved,
    textElementsPreserved,
    pasteRangePreserved,
    canonicalTurnIdentityPreserved,
    canonicalIdentityPreserved,
    canonicalTextPreserved,
    canonicalSkillPreserved,
    pathIdentityPreserved,
    imageIdentityPreserved,
    canonicalFullInputPreserved,
    mediaReadObserved,
    canonicalImageBytesPreserved,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    ...checks,
    threadId,
    requestId: request?.id ?? null,
    clientUserMessageId: clientId ?? null,
    itemId: canonicalIdentityPreserved ? users[0].id : null,
    imageUrl,
  };
}
