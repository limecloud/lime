import { SettingsRow, SettingsValueMenu } from "../../SettingsPrimitives";

export function PreferenceMenu<T extends string>({
  label,
  description,
  targetId,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  targetId: string;
  value: T;
  options: readonly { value: T; label: string }[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <SettingsRow label={label} description={description} targetId={targetId}>
      <SettingsValueMenu
        targetId={targetId}
        described={Boolean(description)}
        value={value}
        options={options}
        disabled={disabled}
        onChange={onChange}
      />
    </SettingsRow>
  );
}
