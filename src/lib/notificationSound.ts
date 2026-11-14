import { AppServerClient } from "@/lib/api/appServer";
import { pickFilesFromDialog } from "@/lib/api/filePicker";
import {
  notificationSoundRequest,
  type NotificationSoundChoice,
} from "@/lib/notificationPreferences";

export const CUSTOM_NOTIFICATION_SOUND_STORAGE_KEY =
  "lime.notifications.custom-sound.v1";
export const CUSTOM_NOTIFICATION_SOUND_MAX_BYTES = 256 * 1024;

export interface CustomNotificationSound {
  name: string;
  mime: string;
  dataBase64: string;
  bytes: number;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  aif: "audio/aiff",
  aiff: "audio/aiff",
  caf: "audio/x-caf",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
};

export function readCustomNotificationSound(): CustomNotificationSound | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(CUSTOM_NOTIFICATION_SOUND_STORAGE_KEY) ??
        "null",
    ) as Partial<CustomNotificationSound> | null;
    if (
      !parsed ||
      typeof parsed.name !== "string" ||
      !parsed.name ||
      typeof parsed.mime !== "string" ||
      !parsed.mime ||
      typeof parsed.dataBase64 !== "string" ||
      !parsed.dataBase64 ||
      typeof parsed.bytes !== "number" ||
      !Number.isFinite(parsed.bytes) ||
      parsed.bytes <= 0 ||
      parsed.bytes > CUSTOM_NOTIFICATION_SOUND_MAX_BYTES
    ) {
      return null;
    }
    return {
      name: parsed.name,
      mime: parsed.mime,
      dataBase64: parsed.dataBase64,
      bytes: parsed.bytes,
    };
  } catch {
    return null;
  }
}

function writeCustomNotificationSound(sound: CustomNotificationSound): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(
      CUSTOM_NOTIFICATION_SOUND_STORAGE_KEY,
      JSON.stringify(sound),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearCustomNotificationSound(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CUSTOM_NOTIFICATION_SOUND_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function base64Bytes(dataBase64: string): number {
  const padding = dataBase64.endsWith("==")
    ? 2
    : dataBase64.endsWith("=")
      ? 1
      : 0;
  return Math.floor((dataBase64.length * 3) / 4) - padding;
}

function extensionOf(filePath: string): string {
  return filePath.split(".").at(-1)?.toLowerCase() ?? "";
}

export async function importCustomNotificationSound(
  options: {
    title?: string;
  } = {},
): Promise<CustomNotificationSound | null> {
  const files = await pickFilesFromDialog({
    acceptedFileExtensions: ["wav", "mp3", "aiff", "aif", "caf", "m4a", "ogg"],
    allowMultiple: false,
    title: options.title,
  });
  const file = files[0];
  if (!file) return null;
  const extension = extensionOf(file.fsPath);
  const mime = MIME_BY_EXTENSION[extension];
  if (!mime) {
    throw new Error("unsupported_audio_extension");
  }
  const client = new AppServerClient();
  const response = await client.readFile({ path: file.fsPath });
  const dataBase64 = response.result?.dataBase64;
  if (typeof dataBase64 !== "string" || !dataBase64) {
    throw new Error("invalid_audio_data");
  }
  const bytes = base64Bytes(dataBase64);
  if (bytes <= 0 || bytes > CUSTOM_NOTIFICATION_SOUND_MAX_BYTES) {
    throw new Error("audio_too_large");
  }
  const sound: CustomNotificationSound = {
    name: file.label || file.fsPath.split("/").at(-1) || "sound",
    mime,
    dataBase64,
    bytes,
  };
  if (!writeCustomNotificationSound(sound)) {
    throw new Error("audio_storage_failed");
  }
  return sound;
}

export function resolveNotificationSound(sound: NotificationSoundChoice): {
  playCustom: boolean;
  playClassic: boolean;
  request: { silent?: boolean; sound?: string };
} {
  if (sound === "custom") {
    if (readCustomNotificationSound()) {
      return {
        playCustom: true,
        playClassic: false,
        request: { silent: true },
      };
    }
    // 自定义音效已被清除时回退到默认系统提示音，避免彻底无声。
    return {
      playCustom: false,
      playClassic: false,
      request: notificationSoundRequest("default"),
    };
  }
  return {
    playCustom: false,
    playClassic: sound === "classic",
    request: notificationSoundRequest(sound),
  };
}

export function playClassicNotificationSound(): void {
  try {
    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const now = context.currentTime;
    const playTone = (
      frequency: number,
      start: number,
      duration: number,
      volume: number,
    ) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(volume, now + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + start);
      oscillator.stop(now + start + duration + 0.03);
    };
    playTone(659.25, 0, 0.22, 0.07);
    playTone(523.25, 0.18, 0.3, 0.06);
    window.setTimeout(() => {
      void context.close().catch(() => undefined);
    }, 600);
  } catch {
    // 音频不可用时静默。
  }
}

let activeAudio: HTMLAudioElement | null = null;

export function playCustomNotificationSound(): boolean {
  const sound = readCustomNotificationSound();
  if (!sound || typeof Audio === "undefined") return false;
  try {
    activeAudio?.pause();
    const audio = new Audio(`data:${sound.mime};base64,${sound.dataBase64}`);
    activeAudio = audio;
    void audio.play().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
