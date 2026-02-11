const getWeekKeyForDate = (date: Date): string => {
    const weekStart = new Date(date);
    const day = weekStart.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    weekStart.setDate(weekStart.getDate() + diffToMonday);
    weekStart.setHours(0, 0, 0, 0);

    const year = weekStart.getFullYear();
    const oneJan = new Date(year, 0, 1);
    const weekNum = Math.ceil((((weekStart.getTime() - oneJan.getTime()) / 86400000) + oneJan.getDay() + 1) / 7);
    return `${year}-W${String(weekNum).padStart(2, '0')}`;
};

const getWeekStartFromKey = (weekKey: string): Date | null => {
    const match = weekKey.match(/^(\d{4})-W(?:K)?(\d{1,2})$/i);
    if (!match) return null;

    const year = Number(match[1]);
    const weekNum = Number(match[2]);
    const normalizedKey = `${year}-W${String(weekNum).padStart(2, '0')}`;

    const cursor = new Date(year - 1, 11, 20);
    for (let i = 0; i < 430; i += 1) {
        const probe = new Date(cursor);
        probe.setDate(cursor.getDate() + i);
        probe.setHours(0, 0, 0, 0);

        if (probe.getDay() !== 1) continue;
        if (getWeekKeyForDate(probe) === normalizedKey) return probe;
    }

    return null;
};

export const formatWeekKeyForDisplay = (weekKey: string): string => {
    const match = weekKey.match(/^(\d{4})-W(?:K)?(\d{1,2})$/i);
    if (!match) return weekKey;

    const weekNum = Number(match[2]);
    const weekStart = getWeekStartFromKey(weekKey);
    if (!weekStart) return `WK${weekNum}`;

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 4);

    const startMonth = weekStart.toLocaleDateString('en-US', { month: 'short' });
    const startDay = weekStart.toLocaleDateString('en-US', { day: '2-digit' });
    const endMonth = weekEnd.toLocaleDateString('en-US', { month: 'short' });
    const endDay = weekEnd.toLocaleDateString('en-US', { day: '2-digit' });

    return `WK${weekNum} ${startMonth}${startDay}-${endMonth}${endDay}`;
};
