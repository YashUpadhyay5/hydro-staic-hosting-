export class FormulaExtender {
  /**
   * Adjust cell references inside an Excel formula string when shifting rows
   * Example: "=+D12+E12-F12" -> "=+D15+E15-F15"
   */
  static shiftFormulaRowReferences(formulaStr, rowDelta) {
    if (!formulaStr || typeof formulaStr !== 'string') return formulaStr;
    if (rowDelta === 0) return formulaStr;

    // Regex to match cell references like A1, D12, $E$12
    return formulaStr.replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g, (match, col, row) => {
      // Don't shift if row is absolute ($12)
      if (col.endsWith('$')) return match;
      const newRow = parseInt(row, 10) + rowDelta;
      return `${col}${newRow}`;
    });
  }

  /**
   * Extends SUM or generic ranges in formulas (e.g. SUM(G12:G15) -> SUM(G12:G50))
   */
  static extendRangeFormula(formulaStr, oldEndRow, newEndRow) {
    if (!formulaStr || typeof formulaStr !== 'string') return formulaStr;
    const regex = new RegExp(`(\\d+)`, 'g');
    return formulaStr.replace(regex, (match) => {
      if (parseInt(match, 10) === oldEndRow) {
        return String(newEndRow);
      }
      return match;
    });
  }
}
