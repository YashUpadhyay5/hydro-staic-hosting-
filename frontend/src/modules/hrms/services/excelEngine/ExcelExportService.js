import { ExcelTemplateLoader } from './ExcelTemplateLoader.js';
import { SheetRenderer } from './SheetRenderer.js';
import { AttendanceColumnGenerator } from './AttendanceColumnGenerator.js';
import { resolvePayrollRunItems, resolveOverrideValue } from '../payrollItemResolver.js';

export class ExcelExportService {
  /**
   * Helper to ensure live pay run items from DB are used if not provided in parameters
   */
  static async resolvePayRunItems(selectedMonth, payslips = [], employees = [], attendance = [], leaves = []) {
    try {
      const { api } = await import('../api.js');
      const runs = await api.getPayrollRuns();
      if (Array.isArray(runs) && runs.length > 0) {
        const targetRun = runs.find(r => r.month === selectedMonth && (r.status === 'PAID' || r.status === 'COMPLETED' || r.status === 'APPROVED'))
          || runs.find(r => r.month === selectedMonth);

        if (targetRun) {
          const items = await api.getPayrollRunItems(targetRun.id).catch(() => []);
          let ws = null;
          try {
            const stateRes = await api.getPayRunState(targetRun.id);
            ws = stateRes?.wizardState || targetRun.wizardState;
            if (typeof ws === 'string') ws = JSON.parse(ws);
          } catch (e) {}

          const baseItems = (Array.isArray(items) && items.length > 0)
            ? items
            : (Array.isArray(payslips) && payslips.length > 0 ? payslips : []);

          return resolvePayrollRunItems(targetRun, baseItems, ws, employees, attendance, leaves);
        }
      }
    } catch (e) {
      console.warn('Could not auto-load pay run items for export:', e);
    }

    return (Array.isArray(payslips) && payslips.length > 0) ? payslips : [];
  }

  /**
   * Export all forms as multi-sheet official template Excel (.xlsx) file
   */
  static async exportAllFormsToExcel(selectedMonth = new Date().toISOString().slice(0, 7), employees = [], attendance = [], leaves = [], payslips = []) {
    try {
      payslips = await this.resolvePayRunItems(selectedMonth, payslips, employees, attendance, leaves);
      const workbook = await ExcelTemplateLoader.loadTemplate();

      // Render each sheet on the official template workbook
      const wsFormU = workbook.getWorksheet('Form U');
      if (wsFormU) SheetRenderer.renderFormU(wsFormU, employees, selectedMonth);

      const wsFormS = workbook.getWorksheet('Form S');
      if (wsFormS) SheetRenderer.renderFormS(wsFormS, employees, selectedMonth);

      const wsFormVMuster = workbook.getWorksheet('Form V Muster');
      if (wsFormVMuster) SheetRenderer.renderFormVMuster(wsFormVMuster, employees, attendance, leaves, selectedMonth);

      const wsFormVReg = workbook.getWorksheet('Form V Register');
      if (wsFormVReg) SheetRenderer.renderFormVRegister(wsFormVReg, employees, attendance, leaves, selectedMonth);

      const wsFormW = workbook.getWorksheet('Form W');
      if (wsFormW) SheetRenderer.renderFormW(wsFormW, employees, attendance, payslips, selectedMonth);

      const wsFormX = workbook.getWorksheet('Form X');
      if (wsFormX) SheetRenderer.renderFormX(wsFormX, employees, leaves, selectedMonth);

      const wsFormT = workbook.getWorksheet('Form T');
      if (wsFormT) SheetRenderer.renderFormT(wsFormT, employees, payslips, selectedMonth);

      // Generate binary buffer and download
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      const monthLabel = AttendanceColumnGenerator.getFormattedDayHeader(selectedMonth, 1).slice(3).replace(/\s+/g, '_');
      const filename = `HR_Compliance_Forms_Official_${monthLabel}.xlsx`;

      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Error generating official compliance excel:', err);
      alert('Could not generate Excel template output. Please check console logs.');
    }
  }

  /**
   * Export single form on official template workbook
   * Strips all other 6 sheets so output is 100% focused and contains ONLY the requested form
   */
  static async exportSingleFormToExcel(formKey, selectedMonth = new Date().toISOString().slice(0, 7), employees = [], attendance = [], leaves = [], payslips = []) {
    try {
      if (formKey === 'Form W' || formKey === 'Form T') {
        payslips = await this.resolvePayRunItems(selectedMonth, payslips, employees, attendance, leaves);
      }
      const workbook = await ExcelTemplateLoader.loadTemplate();
      const targetSheet = workbook.getWorksheet(formKey);

      if (!targetSheet) {
        throw new Error(`Worksheet ${formKey} not found in template`);
      }

      if (formKey === 'Form U') SheetRenderer.renderFormU(targetSheet, employees, selectedMonth);
      else if (formKey === 'Form S') SheetRenderer.renderFormS(targetSheet, employees, selectedMonth);
      else if (formKey === 'Form V Muster') SheetRenderer.renderFormVMuster(targetSheet, employees, attendance, leaves, selectedMonth);
      else if (formKey === 'Form V Register') SheetRenderer.renderFormVRegister(targetSheet, employees, attendance, leaves, selectedMonth);
      else if (formKey === 'Form W') SheetRenderer.renderFormW(targetSheet, employees, attendance, payslips, selectedMonth);
      else if (formKey === 'Form X') SheetRenderer.renderFormX(targetSheet, employees, leaves, selectedMonth);
      else if (formKey === 'Form T') SheetRenderer.renderFormT(targetSheet, employees, payslips, selectedMonth);

      // Remove all worksheets EXCEPT the target form
      const sheetsToRemove = workbook.worksheets.filter(ws => ws.name !== formKey);
      sheetsToRemove.forEach(ws => {
        workbook.removeWorksheet(ws.id);
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      const monthLabel = AttendanceColumnGenerator.getFormattedDayHeader(selectedMonth, 1).slice(3).replace(/\s+/g, '_');
      const filename = `${formKey.replace(/\s+/g, '_')}_Official_${monthLabel}.xlsx`;

      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error(`Error exporting ${formKey}:`, err);
      alert(`Could not export ${formKey}. Please check console logs.`);
    }
  }
}
