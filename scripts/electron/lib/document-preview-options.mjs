import assert from "node:assert/strict";

/** 在创建进程、文件和证据前验证每种独立源稿的场景组合。 */
export function parseDocumentPreviewOptions(argv) {
  const runId = argv[2];
  const withAnnotations = argv.includes("--annotations");
  const withOfficeLifecycle = argv.includes("--office-lifecycle");
  const withMediaPreview = argv.includes("--media-preview");
  const withWorkbookEditing = argv.includes("--workbook-editing");
  const withWorkbookClipboard = argv.includes("--workbook-clipboard");
  const withPresentationEditing = argv.includes("--presentation-editing");
  const withPresentationTableStructure = argv.includes(
    "--presentation-table-structure",
  );
  const withPresentationTableAdvanced = argv.includes(
    "--presentation-table-advanced",
  );
  const withPresentationTableFormat = argv.includes(
    "--presentation-table-format",
  );
  const withPresentationTableBuiltin = argv.includes(
    "--presentation-table-builtin",
  );
  const withPresentationElements = argv.includes("--presentation-elements");
  const withPresentationRichText = argv.includes("--presentation-rich-text");
  const withPresentationTable =
    argv.includes("--presentation-table") ||
    withPresentationTableStructure ||
    withPresentationTableAdvanced;
  assert.ok(
    !(
      (withPresentationTableStructure && withPresentationTableAdvanced) ||
      [
        withPresentationTable,
        withPresentationTableFormat,
        withPresentationTableBuiltin,
        withPresentationElements,
        withPresentationRichText,
      ].filter(Boolean).length > 1
    ),
    "table and element scenarios require independent source fixtures",
  );
  const withPresentationStructure = argv.includes("--presentation-structure");
  const withPresentationNavigation = argv.includes("--presentation-navigation");
  const withDelimitedEditing = argv.includes("--delimited-editing");
  const withBatchAnnotations = argv.includes("--batch-annotations");
  const fromComposer = argv.includes("--composer-annotations");
  assert.ok(
    !fromComposer || withAnnotations,
    "Composer scenario extends annotations",
  );
  assert.ok(
    !withBatchAnnotations || withAnnotations,
    "batch extends the annotation scenario",
  );
  const format = withMediaPreview
    ? "media"
    : argv.includes("--presentation")
      ? "presentation"
      : argv.includes("--workbook")
        ? "workbook"
        : argv.includes("--docx")
          ? "docx"
          : "pdf";
  assert.ok(
    !withWorkbookClipboard ||
      (format === "workbook" &&
        !withWorkbookEditing &&
        !withDelimitedEditing &&
        !withAnnotations),
    "workbook clipboard uses independent XLSX/CSV/TSV source fixtures",
  );
  assert.ok(
    !withBatchAnnotations || format === "docx",
    "batch native fixture currently covers DOCX",
  );
  assert.ok(
    !fromComposer || format !== "docx" || withBatchAnnotations,
    "DOCX Composer scenario extends batch annotations",
  );
  const filename =
    format === "media"
      ? "Preview-image.png"
      : format === "presentation"
        ? "Preview-report.pptx"
        : format === "workbook"
          ? "Preview-report.xlsx"
          : format === "docx"
            ? "Preview-report.docx"
            : "Preview-report.pdf";
  assert.ok(
    !(
      withPresentationStructure ||
      withPresentationNavigation ||
      withPresentationEditing ||
      withPresentationTable ||
      withPresentationTableFormat ||
      withPresentationTableBuiltin ||
      withPresentationElements ||
      withPresentationRichText
    ) || format === "presentation",
    "slide structure/navigation scenario requires presentation format",
  );
  assert.ok(
    !(
      withPresentationTable ||
      withPresentationTableFormat ||
      withPresentationTableBuiltin ||
      withPresentationElements ||
      withPresentationRichText
    ) ||
      !(
        withPresentationStructure ||
        withPresentationEditing ||
        withPresentationNavigation ||
        withAnnotations
      ),
    "table scenario uses its independent source fixture",
  );
  assert.match(runId ?? "", /^[a-zA-Z0-9_-]+$/, "provide a fresh run id");
  assert.ok(
    !withMediaPreview ||
      !(
        withAnnotations ||
        withOfficeLifecycle ||
        withWorkbookEditing ||
        withWorkbookClipboard ||
        withDelimitedEditing ||
        withPresentationEditing ||
        withPresentationStructure ||
        withPresentationNavigation ||
        withPresentationTable ||
        withPresentationTableFormat ||
        withPresentationTableBuiltin ||
        withPresentationElements ||
        withPresentationRichText ||
        ["--presentation", "--workbook", "--docx"].some((flag) =>
          argv.includes(flag),
        )
      ),
    "media preview requires independent image/audio/video source fixtures",
  );
  assert.ok(
    !withOfficeLifecycle ||
      (["workbook", "presentation"].includes(format) &&
        !withAnnotations &&
        !withWorkbookEditing &&
        !withWorkbookClipboard &&
        !withDelimitedEditing &&
        !withPresentationEditing &&
        !withPresentationStructure &&
        !withPresentationNavigation &&
        !withPresentationTable &&
        !withPresentationTableFormat &&
        !withPresentationTableBuiltin &&
        !withPresentationElements &&
        !withPresentationRichText),
    "Office close lifecycle requires an independent workbook or presentation source",
  );
  return {
    runId,
    withAnnotations,
    withOfficeLifecycle,
    withMediaPreview,
    withWorkbookEditing,
    withWorkbookClipboard,
    withPresentationEditing,
    withPresentationTableStructure,
    withPresentationTableAdvanced,
    withPresentationTableFormat,
    withPresentationTableBuiltin,
    withPresentationElements,
    withPresentationRichText,
    withPresentationTable,
    withPresentationStructure,
    withPresentationNavigation,
    withDelimitedEditing,
    withBatchAnnotations,
    fromComposer,
    format,
    filename,
  };
}
