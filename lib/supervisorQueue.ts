import { DEPT_ORDER } from './departmentConfig';
import type { Department, Job } from '@/types';

export const isJobAtOrBeforeDepartment = (
    jobCurrentDepartment: Department,
    selectedDepartment: Department
): boolean => {
    const jobDeptIndex = DEPT_ORDER.indexOf(jobCurrentDepartment);
    const selectedDeptIndex = DEPT_ORDER.indexOf(selectedDepartment);

    // Unknown ordering should not hide jobs.
    if (jobDeptIndex < 0 || selectedDeptIndex < 0) return true;

    return jobDeptIndex <= selectedDeptIndex;
};

export const shouldIncludeJobForDepartmentQueue = (
    job: Pick<Job, 'currentDepartment'>,
    selectedDepartment: Department
): boolean => isJobAtOrBeforeDepartment(job.currentDepartment, selectedDepartment);

