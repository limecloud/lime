import type { ReactNode, Ref } from "react";
import styled from "styled-components";
import type { ComposerLayout } from "./useComposerLayout";

const Footer = styled.div`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  column-gap: 4px;
  min-width: 0;
  padding-inline: 8px;
  padding-bottom: 8px;

  [data-composer-footer-input] {
    grid-column: 1 / -1;
    grid-row: 1;
    min-width: 0;
    margin-inline: -8px;
    margin-bottom: 4px;
  }

  [data-composer-footer-input][aria-hidden="true"] {
    height: 0;
    margin-bottom: 0;
    overflow: hidden;
    visibility: hidden;
  }

  [data-composer-dictation-controls] {
    grid-column: 1 / -1;
    grid-row: 2;
    min-width: 0;
  }

  [data-composer-leading-controls][hidden],
  [data-composer-trailing-controls][hidden] {
    display: none;
  }

  [data-composer-leading-controls] {
    grid-column: 1;
    grid-row: 2;
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;

    > * {
      gap: 4px;
      flex-wrap: nowrap;
    }
  }

  [data-composer-trailing-controls] {
    grid-column: 2;
    grid-row: 2;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-width: 0;

    [data-inline-control] {
      width: 100%;
      min-width: 0;
      max-width: 100%;
    }
  }

  @container composer (min-width: 40rem) {
    &[data-composer-rows="responsive"] {
      grid-template-columns: auto minmax(0, 1fr) auto;
      [data-composer-footer-input] {
        grid-column: 2;
        grid-row: 1;
        margin: 0;
      }
      [data-composer-leading-controls] {
        grid-row: 1;
      }
      [data-composer-trailing-controls] {
        grid-column: 3;
        grid-row: 1;
      }
    }
  }
`;

const ModelControl = styled.div`
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;

  > * {
    min-width: 0;
    flex-wrap: nowrap;
  }
`;

interface AdaptiveFooterProps {
  input: ReactNode;
  leadingControls: ReactNode;
  modelControl?: ReactNode;
  trailingControls: ReactNode;
  layout?: ComposerLayout;
  isComposing?: boolean;
  inputRef?: Ref<HTMLDivElement>;
  dictation?: { showTranscript: boolean; controls: ReactNode };
}

/** 主输入与底栏共用槽位；布局变化不重新挂载 EditorView。 */
export function AdaptiveFooter({
  input,
  leadingControls,
  modelControl,
  trailingControls,
  layout = "multiline",
  isComposing = false,
  inputRef,
  dictation,
}: AdaptiveFooterProps) {
  return (
    <Footer
      data-composer-layout={layout}
      data-composer-rows={
        dictation || layout === "multiline" ? "stacked" : "responsive"
      }
      data-composer-footer-responsive=""
      data-composer-composing={isComposing || undefined}
      data-composer-dictation-view={
        dictation ? (dictation.showTranscript ? "text" : "waveform") : undefined
      }
    >
      <div
        ref={inputRef}
        data-composer-footer-input=""
        data-composer-layout={layout}
        aria-hidden={(dictation && !dictation.showTranscript) || undefined}
        {...(dictation && !dictation.showTranscript ? { inert: "" } : {})}
      >
        {input}
      </div>
      <div data-composer-leading-controls="" hidden={Boolean(dictation)}>
        {leadingControls}
      </div>
      <div data-composer-trailing-controls="" hidden={Boolean(dictation)}>
        {modelControl ? <ModelControl>{modelControl}</ModelControl> : null}
        {trailingControls}
      </div>
      {dictation ? (
        <div data-composer-dictation-controls="">{dictation.controls}</div>
      ) : null}
    </Footer>
  );
}
