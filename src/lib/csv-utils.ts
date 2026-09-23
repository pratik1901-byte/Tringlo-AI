import Papa from "papaparse";
import type { Lead, CSVValidationError, CSVParseResult } from "./types";

const VALID_TIMEZONES = new Set([
    "Asia/Kolkata", "Asia/Calcutta", "Asia/Mumbai",
    "Asia/Chennai", "Asia/Delhi", "UTC", "GMT",
    "America/New_York", "America/Los_Angeles", "America/Chicago",
    "Europe/London", "Europe/Paris", "Asia/Tokyo", "Asia/Singapore",
    "Asia/Dubai", "Asia/Shanghai", "Australia/Sydney",
]);

function generateId(): string {
    return `lead_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function validatePhone(phone: string): boolean {
    const cleaned = phone.replace(/[\s\-().]/g, "");
    // Accept international formats like +91XXXXXXXXXX or plain 10-digit numbers
    return /^\+?\d{10,15}$/.test(cleaned);
}

function validateDate(dateStr: string): boolean {
    const match = dateStr.match(/^\d{4}-\d{2}-\d{2}$/);
    if (!match) return false;
    const d = new Date(dateStr);
    return !isNaN(d.getTime());
}

function validateTime(timeStr: string): boolean {
    return /^\d{2}:\d{2}$/.test(timeStr);
}

function validateTimezone(tz: string): boolean {
    if (VALID_TIMEZONES.has(tz)) return true;
    try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

export function parseCSV(file: File): Promise<CSVParseResult> {
    return new Promise((resolve) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (header: string) => header.trim().toLowerCase().replace(/\s+/g, "_"),
            complete: (results) => {
                const errors: CSVValidationError[] = [];
                const valid: Lead[] = [];
                const seen = new Set<string>();
                const rows = results.data as Record<string, string>[];

                rows.forEach((row, index) => {
                    const rowNum = index + 2; // 1-indexed + header row
                    const name = row["name"]?.trim();
                    const phone = row["phone_number"]?.trim() || row["phone"]?.trim();
                    const callingDate = row["calling_date"]?.trim() || row["date"]?.trim();
                    const callingTime = row["calling_time"]?.trim() || row["time"]?.trim();
                    const timezone = row["timezone"]?.trim();

                    // Validate required fields
                    if (!name) {
                        errors.push({ row: rowNum, field: "name", message: "Name is required" });
                        return;
                    }
                    if (!phone) {
                        errors.push({ row: rowNum, field: "phone_number", message: "Phone number is required" });
                        return;
                    }
                    if (!callingDate) {
                        errors.push({ row: rowNum, field: "calling_date", message: "Calling date is required" });
                        return;
                    }
                    if (!callingTime) {
                        errors.push({ row: rowNum, field: "calling_time", message: "Calling time is required" });
                        return;
                    }
                    if (!timezone) {
                        errors.push({ row: rowNum, field: "timezone", message: "Timezone is required" });
                        return;
                    }

                    // Validate formats
                    if (!validatePhone(phone)) {
                        errors.push({ row: rowNum, field: "phone_number", message: `Invalid phone number: ${phone}` });
                        return;
                    }
                    if (!validateDate(callingDate)) {
                        errors.push({ row: rowNum, field: "calling_date", message: `Invalid date format: ${callingDate} (expected YYYY-MM-DD)` });
                        return;
                    }
                    if (!validateTime(callingTime)) {
                        errors.push({ row: rowNum, field: "calling_time", message: `Invalid time format: ${callingTime} (expected HH:MM)` });
                        return;
                    }
                    if (!validateTimezone(timezone)) {
                        errors.push({ row: rowNum, field: "timezone", message: `Invalid timezone: ${timezone}` });
                        return;
                    }

                    // Check duplicates
                    const key = phone.replace(/[\s\-().]/g, "");
                    if (seen.has(key)) {
                        errors.push({ row: rowNum, field: "phone_number", message: `Duplicate phone number: ${phone}` });
                        return;
                    }
                    seen.add(key);

                    valid.push({
                        id: generateId(),
                        name,
                        phone,
                        email: row["email"]?.trim() || undefined,
                        company: row["company"]?.trim() || undefined,
                        notes: row["notes"]?.trim() || undefined,
                        campaign: row["campaign"]?.trim() || undefined,
                        callingDate,
                        callingTime,
                        timezone,
                        createdAt: new Date().toISOString(),
                        status: "queued",
                        suppressed: false,
                    });
                });

                resolve({ valid, errors, totalRows: rows.length });
            },
            error: () => {
                resolve({
                    valid: [],
                    errors: [{ row: 0, field: "file", message: "Failed to parse CSV file. Please check the file format." }],
                    totalRows: 0,
                });
            },
        });
    });
}

export function exportToCSV(data: Record<string, unknown>[], filename: string): void {
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
}
