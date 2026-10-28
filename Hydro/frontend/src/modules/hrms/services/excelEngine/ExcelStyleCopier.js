export class ExcelStyleCopier {
  /**
   * Deep copy style properties from source cell to target cell
   */
  static copyCellFormat(srcCell, targetCell) {
    if (!srcCell || !targetCell) return;

    if (srcCell.font) {
      targetCell.font = JSON.parse(JSON.stringify(srcCell.font));
    }
    if (srcCell.fill) {
      targetCell.fill = JSON.parse(JSON.stringify(srcCell.fill));
    }
    if (srcCell.border) {
      targetCell.border = JSON.parse(JSON.stringify(srcCell.border));
    }
    if (srcCell.alignment) {
      targetCell.alignment = JSON.parse(JSON.stringify(srcCell.alignment));
    }
    if (srcCell.numFmt) {
      targetCell.numFmt = srcCell.numFmt;
    }
    if (srcCell.protection) {
      targetCell.protection = JSON.parse(JSON.stringify(srcCell.protection));
    }
  }

  /**
   * Copy entire row formatting from source row to target row
   */
  static copyRowFormat(srcRow, targetRow, maxCols = 50) {
    if (!srcRow || !targetRow) return;
    if (srcRow.height) targetRow.height = srcRow.height;

    for (let c = 1; c <= maxCols; c++) {
      const srcCell = srcRow.getCell(c);
      const targetCell = targetRow.getCell(c);
      this.copyCellFormat(srcCell, targetCell);
    }
  }
}
