/**
 * Sales Representative Email Lookup
 * ----------------------------------
 * Maps the Code_Sort column (column L) from the XLSX export
 * to the corresponding salesperson email address.
 *
 * To add/edit a rep, simply update the SALES_REP_EMAILS map below.
 */

/** Front-office administrator — receives ALL SP adjustment emails */
export const SP_ADMIN_EMAIL = 'Aidao@emjacindustries.com';

/** CC list — always copied on every SP email notification */
export const SP_CC_EMAILS = [
    'Felipep@emjacindustries.com',
    'Coryd@emjacindustries.com',
    'Billr@emjacindustries.com'
];

/**
 * Code_Sort → Salesman email mapping
 * Key = Code_Sort value from XLSX column L (case-insensitive lookup)
 */
const SALES_REP_EMAILS: Record<string, string> = {
    'EN': 'ericn@emjacindustries.com',
    'AD': 'alexd@emjacindustries.com',
    'DB': 'davidb@emjacindustries.com',
    'OB': 'omarb@emjacindustries.com',
    'JO': 'jimo@emjacindustries.com',
    'LA': 'lazaroa@emjacindustries.com',
    'CF': 'chrisf@emjacindustries.com',
    'ND': 'noulyd@stainlessdoors.com',
    'TP': 'tonyp@stainlessdoors.com',
    'ED': 'elid@stainlessdoors.com'
};

/**
 * Look up a salesperson's email by their Code_Sort value.
 * Returns null if the code is not found in the mapping.
 */
export const getSalesRepEmail = (codeSort: string): string | null => {
    if (!codeSort) return null;
    return SALES_REP_EMAILS[codeSort.toUpperCase().trim()] || null;
};

/**
 * Get all valid rep codes (for validation / UI dropdowns)
 */
export const getAllRepCodes = (): string[] => Object.keys(SALES_REP_EMAILS);
