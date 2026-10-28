export class MergeManager {
  /**
   * Safe unmerge and re-merge helpers for ExcelJS worksheets
   */
  static safeMergeCells(worksheet, startRow, startCol, endRow, endCol) {
    try {
      worksheet.mergeCells(startRow, startCol, endRow, endCol);
    } catch (e) {
      // Ignore if already merged
    }
  }

  /**
   * Adjust merged ranges after row insertion
   */
  static shiftMergedRanges(worksheet, insertStartRow, numRowsInserted) {
    if (!worksheet || !worksheet._merges) return;

    const currentMerges = Object.keys(worksheet._merges).map(key => worksheet._merges[key].model);
    
    currentMerges.forEach(merge => {
      // If merge starts below insertion point, shift it down
      if (merge.top > insertStartRow) {
        worksheet.unmergeCells(merge.top, merge.left, merge.bottom, merge.right);
        this.safeMergeCells(
          worksheet,
          merge.top + numRowsInserted,
          merge.left,
          merge.bottom + numRowsInserted,
          merge.right
        );
      }
    });
  }
}
