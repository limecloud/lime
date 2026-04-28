export function shouldReserveMacWindowControls(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform = navigator.platform || "";
  const userAgent = navigator.userAgent || "";
  return /mac/i.test(`${platform} ${userAgent}`);
}
