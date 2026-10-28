const PayrollEngine = require('./PayrollEngine');
const PayslipGenerator = require('./PayslipGenerator');

class PayrollQueue {
  constructor() {
    this.activeJobs = new Map();
  }

  /**
   * Enqueues a pay run processing task asynchronously
   */
  async enqueuePayRun(payrollRunId, options = {}) {
    const jobId = `job_${payrollRunId}_${Date.now()}`;
    
    // Status tracking in-memory
    this.activeJobs.set(jobId, {
      payrollRunId,
      options,
      status: 'PROCESSING',
      progress: 0,
      startedAt: new Date()
    });

    // Run in background without blocking the request thread
    this.processBackgroundJob(jobId, payrollRunId, options).catch(err => {
      console.error(`[PayrollQueue Error] Job ${jobId} failed:`, err);
    });

    return jobId;
  }

  /**
   * Private execution thread
   */
  async processBackgroundJob(jobId, payrollRunId, options = {}) {
    const jobState = this.activeJobs.get(jobId);
    try {
      console.log(`[PayrollQueue Work] Starting background processing for run: ${payrollRunId}`);
      
      // Execute the heavy processing math with options
      const run = await PayrollEngine.executePayRun(payrollRunId, options);

      // Bulk generate payslips if run completed successfully
      if (run.status === 'APPROVED') {
        console.log(`[PayrollQueue Work] Payroll run ${payrollRunId} approved. Generating payslips...`);
        await PayslipGenerator.bulkGenerate(payrollRunId);
      }

      jobState.status = 'COMPLETED';
      jobState.progress = 100;
      jobState.completedAt = new Date();
      this.activeJobs.set(jobId, jobState);
      
      console.log(`[PayrollQueue Work] Background processing complete for run: ${payrollRunId}`);
    } catch (err) {
      console.error(`[PayrollQueue Work Error] Run ${payrollRunId} failed:`, err);
      jobState.status = 'FAILED';
      jobState.error = err.message;
      this.activeJobs.set(jobId, jobState);
    }
  }

  /**
   * Retrieves the current processing status of a background job
   */
  getJobStatus(jobId) {
    return this.activeJobs.get(jobId) || { status: 'NOT_FOUND' };
  }

  /**
   * True while a job for this run is still executing in this server process
   */
  isRunActive(payrollRunId) {
    for (const job of this.activeJobs.values()) {
      if (job.payrollRunId === payrollRunId && job.status === 'PROCESSING') return true;
    }
    return false;
  }
}

module.exports = new PayrollQueue();
