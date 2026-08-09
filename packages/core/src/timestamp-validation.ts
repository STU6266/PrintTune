const ISO_UTC_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

export function isStrictIsoUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const match = ISO_UTC_TIMESTAMP_PATTERN.exec(value);
  const milliseconds = Date.parse(value);
  if (!match || Number.isNaN(milliseconds)) {
    return false;
  }

  const parsedDate = new Date(milliseconds);
  const [, year, month, day, hour, minute, second, fraction = "0"] = match;
  return (
    parsedDate.getUTCFullYear() === Number(year) &&
    parsedDate.getUTCMonth() + 1 === Number(month) &&
    parsedDate.getUTCDate() === Number(day) &&
    parsedDate.getUTCHours() === Number(hour) &&
    parsedDate.getUTCMinutes() === Number(minute) &&
    parsedDate.getUTCSeconds() === Number(second) &&
    parsedDate.getUTCMilliseconds() === Number(fraction.padEnd(3, "0"))
  );
}
