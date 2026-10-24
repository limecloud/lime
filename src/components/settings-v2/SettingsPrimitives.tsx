import {
  Fragment,
  useId,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import styled from "styled-components";

export const SettingsPageBody = styled.div`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 40px;
  padding-bottom: 48px;
  color: var(--lime-text-strong, hsl(var(--foreground)));
  font-size: 13px;
  font-weight: 430;
  line-height: calc(13px * 1.25 / 0.875);
`;

const Header = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 500;
    line-height: 1.2;
    letter-spacing: -0.5px;
  }
`;

export function SettingsPageHeader({
  title,
  actions,
}: {
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Header>
      <h1>{title}</h1>
      {actions}
    </Header>
  );
}

const Section = styled.section`
  min-width: 0;
  > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 46px;
    padding-bottom: 6px;
    margin-bottom: 6px;
  }
  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
  }
`;

export function SettingsSection({
  title,
  actions,
  children,
  ...props
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"section">, "title">) {
  const id = useId();
  return (
    <Section {...props} aria-labelledby={title ? id : props["aria-labelledby"]}>
      {title ? (
        <header>
          <h2 id={id}>{title}</h2>
          {actions}
        </header>
      ) : null}
      {children}
    </Section>
  );
}

export const SettingsGroup = styled.div`
  min-width: 0;
  container-type: inline-size;
  overflow: hidden;
  border: 1px solid var(--lime-surface-border, hsl(var(--border)));
  border-radius: 16px;
  padding-inline: 16px;
  background: var(--lime-settings-surface, hsl(var(--background)));
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding-block: 12px;
  border-bottom: 1px solid var(--lime-surface-border, hsl(var(--border)));
  &:last-child {
    border-bottom: 0;
  }
  flex-wrap: wrap;
  .settings-row-copy {
    min-width: min(100%, 160px);
    flex: 1;
  }
  .settings-row-label {
    font-size: 13px;
    line-height: calc(13px * 1.25 / 0.875);
    font-weight: 500;
  }
  .settings-row-description {
    margin: 2px 0 0;
    color: var(--lime-text-muted, hsl(var(--muted-foreground)));
    font-size: 12px;
    line-height: 16px;
    overflow-wrap: anywhere;
  }
  .settings-row-control {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
    max-width: 100%;
  }
`;

export function SettingsRow({
  label,
  description,
  targetId,
  children,
  ...props
}: {
  label: ReactNode;
  description?: ReactNode;
  targetId?: string;
  children?: ReactNode;
} & ComponentPropsWithoutRef<"div">) {
  const id = useId();
  const rowId = props.id ?? targetId;
  const labelId = `${rowId ?? id}-label`;
  const descriptionId = `${rowId ?? id}-description`;
  return (
    <Row
      {...props}
      id={rowId}
      data-settings-search-target={targetId}
      tabIndex={targetId ? -1 : props.tabIndex}
      aria-labelledby={props["aria-labelledby"] ?? labelId}
      aria-describedby={
        props["aria-describedby"] ?? (description ? descriptionId : undefined)
      }
    >
      <div className="settings-row-copy">
        <div id={labelId} className="settings-row-label">
          {label}
        </div>
        {description ? (
          <div id={descriptionId} className="settings-row-description">
            {description}
          </div>
        ) : null}
      </div>
      {children ? <div className="settings-row-control">{children}</div> : null}
    </Row>
  );
}

export const SettingsAction = styled.button<{ $tone?: "danger" }>`
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-radius: 8px;
  padding: 4px 10px;
  background: var(--lime-surface-subtle, hsl(var(--muted)));
  color: ${({ $tone }) =>
    $tone === "danger"
      ? "var(--lime-danger, hsl(var(--destructive)))"
      : "var(--lime-text-strong, hsl(var(--foreground)))"};
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
  &:hover {
    background: var(--lime-surface-hover, hsl(var(--accent)));
  }
  &:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
  svg {
    width: 14px;
    height: 14px;
  }
`;

export const SettingsSelect = styled.select`
  max-width: 100%;
  min-height: 28px;
  border: 1px solid var(--lime-surface-border, hsl(var(--border)));
  border-radius: 8px;
  padding: 3px 24px 3px 10px;
  background-color: var(--lime-settings-surface, hsl(var(--background)));
  color: var(--lime-text-strong, hsl(var(--foreground)));
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
  &:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

export function SettingsValueMenu<T extends string>({
  targetId,
  described,
  value,
  options,
  disabled,
  onChange,
  align = "end",
}: {
  targetId: string;
  described?: boolean;
  value: T;
  options: readonly {
    value: T;
    label: string;
    description?: string;
    tooltip?: string;
    groupLabel?: string;
    disabled?: boolean;
  }[];
  disabled: boolean;
  onChange: (value: T) => void;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger asChild>
        <SettingsAction
          type="button"
          className="min-w-0 max-w-full"
          disabled={disabled}
          aria-labelledby={`${targetId}-label ${targetId}-value`}
          aria-describedby={described ? `${targetId}-description` : undefined}
        >
          <span id={`${targetId}-value`} className="min-w-0 truncate">
            {options.find((option) => option.value === value)?.label}
          </span>
          <ChevronDown aria-hidden="true" className="shrink-0" />
        </SettingsAction>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align={align}
          sideOffset={4}
          className="z-[70] min-w-44 rounded-xl border border-border bg-popover p-1 text-[13px] text-popover-foreground shadow-lg"
          onKeyDown={(event) => {
            // 焦点可能早于 Radix 注册最高层，已处理的 Escape 不重复关闭。
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.preventDefault();
              setOpen(false);
            }
          }}
        >
          <Menu.RadioGroup
            value={value}
            onValueChange={(next) => {
              const option = options.find((item) => item.value === next);
              if (
                option &&
                option.value !== value &&
                !option.disabled &&
                !disabled
              )
                onChange(option.value);
            }}
          >
            {options.map((option, index) => (
              <Fragment key={option.value}>
                {index > 0 &&
                option.groupLabel !== options[index - 1]?.groupLabel ? (
                  <Menu.Separator className="my-1 h-px bg-border" />
                ) : null}
                {option.groupLabel &&
                option.groupLabel !== options[index - 1]?.groupLabel ? (
                  <Menu.Label className="px-2 py-1 text-[12px] text-muted-foreground">
                    {option.groupLabel}
                  </Menu.Label>
                ) : null}
                <Menu.RadioItem
                  key={option.value}
                  value={option.value}
                  title={option.tooltip}
                  disabled={option.disabled}
                  className="flex min-h-7 max-w-[min(400px,80vw)] cursor-default items-center justify-between gap-4 rounded-lg px-2 py-1 outline-none focus:bg-accent data-[disabled]:opacity-50"
                >
                  <span>
                    {option.label}
                    {option.description ? (
                      <span className="mt-1 block text-[12px] leading-4 text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  <Menu.ItemIndicator>
                    <Check className="size-3.5" aria-hidden="true" />
                  </Menu.ItemIndicator>
                </Menu.RadioItem>
              </Fragment>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

const SwitchRoot = styled(SwitchPrimitive.Root)`
  display: inline-flex;
  width: 32px;
  height: 20px;
  flex-shrink: 0;
  align-items: center;
  border: 0;
  border-radius: 999px;
  padding: 2px;
  background: var(--lime-surface-border, hsl(var(--muted)));
  transition: background-color 120ms;
  cursor: pointer;
  &[data-state="checked"] {
    background: var(--lime-info, hsl(var(--primary)));
  }
  &:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 3px;
  }
  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
  span {
    display: block;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: white;
    box-shadow: 0 1px 2px rgb(0 0 0 / 12%);
    transform: translateX(0);
    transition: transform 120ms;
  }
  &[data-state="checked"] span {
    transform: translateX(12px);
  }
`;

export function SettingsSwitch(
  props: ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>,
) {
  return (
    <SwitchRoot {...props}>
      <SwitchPrimitive.Thumb />
    </SwitchRoot>
  );
}

export const SettingsEmptyState = styled.div`
  padding: 24px 16px;
  color: var(--lime-text-muted, hsl(var(--muted-foreground)));
  font-size: 13px;
  line-height: 20px;
  text-align: center;
`;

export function SettingsLoading() {
  return (
    <SettingsPageBody aria-busy="true" role="status">
      <div className="h-8 w-24 animate-pulse rounded bg-muted" />
      <div className="h-60 animate-pulse rounded-2xl border border-border" />
    </SettingsPageBody>
  );
}
