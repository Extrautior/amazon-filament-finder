function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second
  };
}

function zonedDateTimeToUtc({ year, month, day, hour, minute = 0, second = 0 }, timeZone) {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = zonedParts(guess, timeZone);
    const desiredMs = Date.UTC(year, month - 1, day, hour, minute, second);
    const actualMs = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    );
    const diffMs = desiredMs - actualMs;
    if (diffMs === 0) {
      return guess;
    }
    guess = new Date(guess.getTime() + diffMs);
  }

  return guess;
}

function getNextAutoRefreshRun(now = new Date(), options = {}) {
  const timeZone = options.timeZone || "Asia/Jerusalem";
  const hours = Array.isArray(options.hours) && options.hours.length ? [...options.hours].sort((a, b) => a - b) : [8, 20];
  const localNow = zonedParts(now, timeZone);

  for (let dayOffset = 0; dayOffset < 4; dayOffset += 1) {
    const localDay = new Date(Date.UTC(localNow.year, localNow.month - 1, localNow.day + dayOffset, 12, 0, 0));
    const year = localDay.getUTCFullYear();
    const month = localDay.getUTCMonth() + 1;
    const day = localDay.getUTCDate();

    for (const hour of hours) {
      const candidate = zonedDateTimeToUtc({ year, month, day, hour, minute: 0, second: 0 }, timeZone);
      if (candidate.getTime() > now.getTime()) {
        return candidate;
      }
    }
  }

  return zonedDateTimeToUtc(
    { year: localNow.year, month: localNow.month, day: localNow.day + 1, hour: hours[0], minute: 0, second: 0 },
    timeZone
  );
}

module.exports = {
  getNextAutoRefreshRun,
  zonedDateTimeToUtc,
  zonedParts
};
