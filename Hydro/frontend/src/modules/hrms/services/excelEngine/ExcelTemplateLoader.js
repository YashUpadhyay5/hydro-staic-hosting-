import { TEMPLATE_BASE64 } from './templateBinary.js';

export class ExcelTemplateLoader {
  static async loadTemplate() {
    // Dynamic import — ExcelJS (1.3 MB) only downloads when user actually clicks Export Excel
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    try {
      // Decode base64 template string to ArrayBuffer
      const binaryString = atob(TEMPLATE_BASE64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      await workbook.xlsx.load(bytes.buffer);
      return workbook;
    } catch (err) {
      console.error('Error loading embedded base64 template, attempting fetch fallback:', err);
      // Fallback to fetch if base64 decoding fails
      const response = await fetch('/templates/HR_Compliance_Forms_Template.xlsx');
      const arrayBuffer = await response.arrayBuffer();
      await workbook.xlsx.load(arrayBuffer);
      return workbook;
    }
  }
}
