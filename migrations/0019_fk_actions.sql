-- DB-MODEL-004: mọi khoá ngoại khai ON DELETE tường minh + có index trên cột khoá ngoại (hỗ trợ kiểm tra khi xoá/sửa bản ghi cha).
-- Quy tắc: dữ liệu nghiệp vụ → RESTRICT (không xoá cha khi còn con, kiểm ngay chứ không hoãn như NO ACTION);
-- CASCADE chỉ cho bản ghi thuần phụ thuộc vòng đời cha — hiện chỉ `session` theo `app_user`. audit_event không có FK
-- và không bao giờ cascade (chuỗi băm chỉ thêm). Không đổi dữ liệu; tên ràng buộc giữ nguyên.

ALTER TABLE app_user
  DROP CONSTRAINT app_user_company_id_employee_id_fkey,
  ADD CONSTRAINT app_user_company_id_employee_id_fkey FOREIGN KEY (company_id, employee_id) REFERENCES employee(company_id, id) ON DELETE RESTRICT;

ALTER TABLE app_user
  DROP CONSTRAINT app_user_company_id_fkey,
  ADD CONSTRAINT app_user_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE attendance_adjustment
  DROP CONSTRAINT attendance_adjustment_company_id_employee_id_fkey,
  ADD CONSTRAINT attendance_adjustment_company_id_employee_id_fkey FOREIGN KEY (company_id, employee_id) REFERENCES employee(company_id, id) ON DELETE RESTRICT;

ALTER TABLE attendance_adjustment
  DROP CONSTRAINT attendance_adjustment_company_id_target_event_id_fkey,
  ADD CONSTRAINT attendance_adjustment_company_id_target_event_id_fkey FOREIGN KEY (company_id, target_event_id) REFERENCES attendance_event(company_id, id) ON DELETE RESTRICT;

ALTER TABLE attendance_event
  DROP CONSTRAINT attendance_event_company_id_employee_id_fkey,
  ADD CONSTRAINT attendance_event_company_id_employee_id_fkey FOREIGN KEY (company_id, employee_id) REFERENCES employee(company_id, id) ON DELETE RESTRICT;

ALTER TABLE attendance_event
  DROP CONSTRAINT attendance_event_company_id_policy_id_fkey,
  ADD CONSTRAINT attendance_event_company_id_policy_id_fkey FOREIGN KEY (company_id, policy_id) REFERENCES attendance_policy(company_id, id) ON DELETE RESTRICT;

ALTER TABLE attendance_event
  DROP CONSTRAINT attendance_event_company_id_shift_assignment_id_fkey,
  ADD CONSTRAINT attendance_event_company_id_shift_assignment_id_fkey FOREIGN KEY (company_id, shift_assignment_id) REFERENCES shift_assignment(company_id, id) ON DELETE RESTRICT;

ALTER TABLE attendance_event
  DROP CONSTRAINT attendance_event_company_id_worksite_id_fkey,
  ADD CONSTRAINT attendance_event_company_id_worksite_id_fkey FOREIGN KEY (company_id, worksite_id) REFERENCES worksite(company_id, id) ON DELETE RESTRICT;

ALTER TABLE attendance_event
  DROP CONSTRAINT attendance_event_voided_fk,
  ADD CONSTRAINT attendance_event_voided_fk FOREIGN KEY (company_id, voided_by_adjustment_id) REFERENCES attendance_adjustment(company_id, id) ON DELETE RESTRICT;

ALTER TABLE attendance_period
  DROP CONSTRAINT attendance_period_company_id_fkey,
  ADD CONSTRAINT attendance_period_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE attendance_policy
  DROP CONSTRAINT attendance_policy_company_id_fkey,
  ADD CONSTRAINT attendance_policy_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE branch
  DROP CONSTRAINT branch_company_id_fkey,
  ADD CONSTRAINT branch_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE cms_page
  DROP CONSTRAINT cms_page_company_id_fkey,
  ADD CONSTRAINT cms_page_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE cms_redirect
  DROP CONSTRAINT cms_redirect_company_id_fkey,
  ADD CONSTRAINT cms_redirect_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE cms_revision
  DROP CONSTRAINT cms_revision_company_id_author_user_id_fkey,
  ADD CONSTRAINT cms_revision_company_id_author_user_id_fkey FOREIGN KEY (company_id, author_user_id) REFERENCES app_user(company_id, id) ON DELETE RESTRICT;

ALTER TABLE cms_revision
  DROP CONSTRAINT cms_revision_company_id_page_id_fkey,
  ADD CONSTRAINT cms_revision_company_id_page_id_fkey FOREIGN KEY (company_id, page_id) REFERENCES cms_page(company_id, id) ON DELETE RESTRICT;

ALTER TABLE cms_revision
  DROP CONSTRAINT cms_revision_company_id_reviewer_user_id_fkey,
  ADD CONSTRAINT cms_revision_company_id_reviewer_user_id_fkey FOREIGN KEY (company_id, reviewer_user_id) REFERENCES app_user(company_id, id) ON DELETE RESTRICT;

ALTER TABLE comment
  DROP CONSTRAINT comment_company_id_fkey,
  ADD CONSTRAINT comment_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE daily_counter
  DROP CONSTRAINT daily_counter_company_id_fkey,
  ADD CONSTRAINT daily_counter_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE department
  DROP CONSTRAINT department_company_id_branch_id_fkey,
  ADD CONSTRAINT department_company_id_branch_id_fkey FOREIGN KEY (company_id, branch_id) REFERENCES branch(company_id, id) ON DELETE RESTRICT;

ALTER TABLE department
  DROP CONSTRAINT department_company_id_fkey,
  ADD CONSTRAINT department_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE department
  DROP CONSTRAINT department_company_id_parent_id_fkey,
  ADD CONSTRAINT department_company_id_parent_id_fkey FOREIGN KEY (company_id, parent_id) REFERENCES department(company_id, id) ON DELETE RESTRICT;

ALTER TABLE document
  DROP CONSTRAINT document_company_id_fkey,
  ADD CONSTRAINT document_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE document_version
  DROP CONSTRAINT document_version_company_id_document_id_fkey,
  ADD CONSTRAINT document_version_company_id_document_id_fkey FOREIGN KEY (company_id, document_id) REFERENCES document(company_id, id) ON DELETE RESTRICT;

ALTER TABLE document_version
  DROP CONSTRAINT document_version_company_id_file_id_fkey,
  ADD CONSTRAINT document_version_company_id_file_id_fkey FOREIGN KEY (company_id, file_id) REFERENCES file_object(company_id, id) ON DELETE RESTRICT;

ALTER TABLE employee
  DROP CONSTRAINT employee_company_id_fkey,
  ADD CONSTRAINT employee_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE employment_history
  DROP CONSTRAINT employment_history_company_id_department_id_fkey,
  ADD CONSTRAINT employment_history_company_id_department_id_fkey FOREIGN KEY (company_id, department_id) REFERENCES department(company_id, id) ON DELETE RESTRICT;

ALTER TABLE employment_history
  DROP CONSTRAINT employment_history_company_id_employee_id_fkey,
  ADD CONSTRAINT employment_history_company_id_employee_id_fkey FOREIGN KEY (company_id, employee_id) REFERENCES employee(company_id, id) ON DELETE RESTRICT;

ALTER TABLE employment_history
  DROP CONSTRAINT employment_history_company_id_manager_employee_id_fkey,
  ADD CONSTRAINT employment_history_company_id_manager_employee_id_fkey FOREIGN KEY (company_id, manager_employee_id) REFERENCES employee(company_id, id) ON DELETE RESTRICT;

ALTER TABLE file_object
  DROP CONSTRAINT file_object_company_id_fkey,
  ADD CONSTRAINT file_object_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE inquiry
  DROP CONSTRAINT inquiry_company_id_assignee_user_id_fkey,
  ADD CONSTRAINT inquiry_company_id_assignee_user_id_fkey FOREIGN KEY (company_id, assignee_user_id) REFERENCES app_user(company_id, id) ON DELETE RESTRICT;

ALTER TABLE inquiry
  DROP CONSTRAINT inquiry_company_id_fkey,
  ADD CONSTRAINT inquiry_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE inquiry_history
  DROP CONSTRAINT inquiry_history_company_id_inquiry_id_fkey,
  ADD CONSTRAINT inquiry_history_company_id_inquiry_id_fkey FOREIGN KEY (company_id, inquiry_id) REFERENCES inquiry(company_id, id) ON DELETE RESTRICT;

ALTER TABLE inquiry_route
  DROP CONSTRAINT inquiry_route_company_id_assignee_user_id_fkey,
  ADD CONSTRAINT inquiry_route_company_id_assignee_user_id_fkey FOREIGN KEY (company_id, assignee_user_id) REFERENCES app_user(company_id, id) ON DELETE RESTRICT;

ALTER TABLE inquiry_route
  DROP CONSTRAINT inquiry_route_company_id_fkey,
  ADD CONSTRAINT inquiry_route_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE job_application
  DROP CONSTRAINT job_application_company_id_fkey,
  ADD CONSTRAINT job_application_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE job_application
  DROP CONSTRAINT job_application_company_id_job_page_id_fkey,
  ADD CONSTRAINT job_application_company_id_job_page_id_fkey FOREIGN KEY (company_id, job_page_id) REFERENCES cms_page(company_id, id) ON DELETE RESTRICT;

ALTER TABLE leave_ledger
  DROP CONSTRAINT leave_ledger_company_id_employee_id_fkey,
  ADD CONSTRAINT leave_ledger_company_id_employee_id_fkey FOREIGN KEY (company_id, employee_id) REFERENCES employee(company_id, id) ON DELETE RESTRICT;

ALTER TABLE leave_ledger
  DROP CONSTRAINT leave_ledger_company_id_leave_request_id_fkey,
  ADD CONSTRAINT leave_ledger_company_id_leave_request_id_fkey FOREIGN KEY (company_id, leave_request_id) REFERENCES leave_request(company_id, id) ON DELETE RESTRICT;

ALTER TABLE leave_ledger
  DROP CONSTRAINT leave_ledger_company_id_leave_type_id_fkey,
  ADD CONSTRAINT leave_ledger_company_id_leave_type_id_fkey FOREIGN KEY (company_id, leave_type_id) REFERENCES leave_type(company_id, id) ON DELETE RESTRICT;

ALTER TABLE leave_request
  DROP CONSTRAINT leave_request_company_id_employee_id_fkey,
  ADD CONSTRAINT leave_request_company_id_employee_id_fkey FOREIGN KEY (company_id, employee_id) REFERENCES employee(company_id, id) ON DELETE RESTRICT;

ALTER TABLE leave_request
  DROP CONSTRAINT leave_request_company_id_leave_type_id_fkey,
  ADD CONSTRAINT leave_request_company_id_leave_type_id_fkey FOREIGN KEY (company_id, leave_type_id) REFERENCES leave_type(company_id, id) ON DELETE RESTRICT;

ALTER TABLE leave_type
  DROP CONSTRAINT leave_type_company_id_fkey,
  ADD CONSTRAINT leave_type_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE milestone
  DROP CONSTRAINT milestone_company_id_project_id_fkey,
  ADD CONSTRAINT milestone_company_id_project_id_fkey FOREIGN KEY (company_id, project_id) REFERENCES project(company_id, id) ON DELETE RESTRICT;

ALTER TABLE ot_policy
  DROP CONSTRAINT ot_policy_company_id_fkey,
  ADD CONSTRAINT ot_policy_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE ot_request
  DROP CONSTRAINT ot_request_company_id_employee_id_fkey,
  ADD CONSTRAINT ot_request_company_id_employee_id_fkey FOREIGN KEY (company_id, employee_id) REFERENCES employee(company_id, id) ON DELETE RESTRICT;

ALTER TABLE ot_request
  DROP CONSTRAINT ot_request_company_id_policy_id_fkey,
  ADD CONSTRAINT ot_request_company_id_policy_id_fkey FOREIGN KEY (company_id, policy_id) REFERENCES ot_policy(company_id, id) ON DELETE RESTRICT;

ALTER TABLE period_exception_note
  DROP CONSTRAINT period_exception_note_period_id_fkey,
  ADD CONSTRAINT period_exception_note_period_id_fkey FOREIGN KEY (period_id) REFERENCES attendance_period(id) ON DELETE RESTRICT;

ALTER TABLE period_export
  DROP CONSTRAINT period_export_period_id_fkey,
  ADD CONSTRAINT period_export_period_id_fkey FOREIGN KEY (period_id) REFERENCES attendance_period(id) ON DELETE RESTRICT;

ALTER TABLE period_line
  DROP CONSTRAINT period_line_period_id_fkey,
  ADD CONSTRAINT period_line_period_id_fkey FOREIGN KEY (period_id) REFERENCES attendance_period(id) ON DELETE RESTRICT;

ALTER TABLE plan_baseline
  DROP CONSTRAINT plan_baseline_company_id_project_id_fkey,
  ADD CONSTRAINT plan_baseline_company_id_project_id_fkey FOREIGN KEY (company_id, project_id) REFERENCES project(company_id, id) ON DELETE RESTRICT;

ALTER TABLE project
  DROP CONSTRAINT project_company_id_fkey,
  ADD CONSTRAINT project_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE project
  DROP CONSTRAINT project_company_id_manager_employee_id_fkey,
  ADD CONSTRAINT project_company_id_manager_employee_id_fkey FOREIGN KEY (company_id, manager_employee_id) REFERENCES employee(company_id, id) ON DELETE RESTRICT;

ALTER TABLE project_member
  DROP CONSTRAINT project_member_company_id_employee_id_fkey,
  ADD CONSTRAINT project_member_company_id_employee_id_fkey FOREIGN KEY (company_id, employee_id) REFERENCES employee(company_id, id) ON DELETE RESTRICT;

ALTER TABLE project_member
  DROP CONSTRAINT project_member_company_id_project_id_fkey,
  ADD CONSTRAINT project_member_company_id_project_id_fkey FOREIGN KEY (company_id, project_id) REFERENCES project(company_id, id) ON DELETE RESTRICT;

ALTER TABLE reconciliation_note
  DROP CONSTRAINT reconciliation_note_company_id_employee_id_fkey,
  ADD CONSTRAINT reconciliation_note_company_id_employee_id_fkey FOREIGN KEY (company_id, employee_id) REFERENCES employee(company_id, id) ON DELETE RESTRICT;

ALTER TABLE role_grant
  DROP CONSTRAINT role_grant_company_id_user_id_fkey,
  ADD CONSTRAINT role_grant_company_id_user_id_fkey FOREIGN KEY (company_id, user_id) REFERENCES app_user(company_id, id) ON DELETE RESTRICT;

ALTER TABLE session
  DROP CONSTRAINT session_user_id_fkey,
  ADD CONSTRAINT session_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE;

ALTER TABLE shift_assignment
  DROP CONSTRAINT shift_assignment_company_id_employee_id_fkey,
  ADD CONSTRAINT shift_assignment_company_id_employee_id_fkey FOREIGN KEY (company_id, employee_id) REFERENCES employee(company_id, id) ON DELETE RESTRICT;

ALTER TABLE shift_assignment
  DROP CONSTRAINT shift_assignment_company_id_shift_template_id_fkey,
  ADD CONSTRAINT shift_assignment_company_id_shift_template_id_fkey FOREIGN KEY (company_id, shift_template_id) REFERENCES shift_template(company_id, id) ON DELETE RESTRICT;

ALTER TABLE shift_assignment
  DROP CONSTRAINT shift_assignment_company_id_worksite_id_fkey,
  ADD CONSTRAINT shift_assignment_company_id_worksite_id_fkey FOREIGN KEY (company_id, worksite_id) REFERENCES worksite(company_id, id) ON DELETE RESTRICT;

ALTER TABLE shift_template
  DROP CONSTRAINT shift_template_company_id_fkey,
  ADD CONSTRAINT shift_template_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE task
  DROP CONSTRAINT task_company_id_project_id_fkey,
  ADD CONSTRAINT task_company_id_project_id_fkey FOREIGN KEY (company_id, project_id) REFERENCES project(company_id, id) ON DELETE RESTRICT;

ALTER TABLE task
  DROP CONSTRAINT task_company_id_responsible_employee_id_fkey,
  ADD CONSTRAINT task_company_id_responsible_employee_id_fkey FOREIGN KEY (company_id, responsible_employee_id) REFERENCES employee(company_id, id) ON DELETE RESTRICT;

ALTER TABLE task
  DROP CONSTRAINT task_company_id_reviewer_employee_id_fkey,
  ADD CONSTRAINT task_company_id_reviewer_employee_id_fkey FOREIGN KEY (company_id, reviewer_employee_id) REFERENCES employee(company_id, id) ON DELETE RESTRICT;

ALTER TABLE task
  DROP CONSTRAINT task_company_id_work_package_id_fkey,
  ADD CONSTRAINT task_company_id_work_package_id_fkey FOREIGN KEY (company_id, work_package_id) REFERENCES work_package(company_id, id) ON DELETE RESTRICT;

ALTER TABLE task_collaborator
  DROP CONSTRAINT task_collaborator_employee_id_fkey,
  ADD CONSTRAINT task_collaborator_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employee(id) ON DELETE RESTRICT;

ALTER TABLE task_collaborator
  DROP CONSTRAINT task_collaborator_task_id_fkey,
  ADD CONSTRAINT task_collaborator_task_id_fkey FOREIGN KEY (task_id) REFERENCES task(id) ON DELETE RESTRICT;

ALTER TABLE task_dependency
  DROP CONSTRAINT task_dependency_company_id_predecessor_id_fkey,
  ADD CONSTRAINT task_dependency_company_id_predecessor_id_fkey FOREIGN KEY (company_id, predecessor_id) REFERENCES task(company_id, id) ON DELETE RESTRICT;

ALTER TABLE task_dependency
  DROP CONSTRAINT task_dependency_company_id_successor_id_fkey,
  ADD CONSTRAINT task_dependency_company_id_successor_id_fkey FOREIGN KEY (company_id, successor_id) REFERENCES task(company_id, id) ON DELETE RESTRICT;

ALTER TABLE task_evidence
  DROP CONSTRAINT task_evidence_company_id_task_id_fkey,
  ADD CONSTRAINT task_evidence_company_id_task_id_fkey FOREIGN KEY (company_id, task_id) REFERENCES task(company_id, id) ON DELETE RESTRICT;

ALTER TABLE task_history
  DROP CONSTRAINT task_history_company_id_task_id_fkey,
  ADD CONSTRAINT task_history_company_id_task_id_fkey FOREIGN KEY (company_id, task_id) REFERENCES task(company_id, id) ON DELETE RESTRICT;

ALTER TABLE timesheet_entry
  DROP CONSTRAINT timesheet_entry_company_id_employee_id_fkey,
  ADD CONSTRAINT timesheet_entry_company_id_employee_id_fkey FOREIGN KEY (company_id, employee_id) REFERENCES employee(company_id, id) ON DELETE RESTRICT;

ALTER TABLE timesheet_entry
  DROP CONSTRAINT timesheet_entry_company_id_project_id_fkey,
  ADD CONSTRAINT timesheet_entry_company_id_project_id_fkey FOREIGN KEY (company_id, project_id) REFERENCES project(company_id, id) ON DELETE RESTRICT;

ALTER TABLE timesheet_entry
  DROP CONSTRAINT timesheet_entry_company_id_task_id_fkey,
  ADD CONSTRAINT timesheet_entry_company_id_task_id_fkey FOREIGN KEY (company_id, task_id) REFERENCES task(company_id, id) ON DELETE RESTRICT;

ALTER TABLE work_package
  DROP CONSTRAINT work_package_company_id_parent_id_fkey,
  ADD CONSTRAINT work_package_company_id_parent_id_fkey FOREIGN KEY (company_id, parent_id) REFERENCES work_package(company_id, id) ON DELETE RESTRICT;

ALTER TABLE work_package
  DROP CONSTRAINT work_package_company_id_project_id_fkey,
  ADD CONSTRAINT work_package_company_id_project_id_fkey FOREIGN KEY (company_id, project_id) REFERENCES project(company_id, id) ON DELETE RESTRICT;

ALTER TABLE worksite
  DROP CONSTRAINT worksite_company_id_branch_id_fkey,
  ADD CONSTRAINT worksite_company_id_branch_id_fkey FOREIGN KEY (company_id, branch_id) REFERENCES branch(company_id, id) ON DELETE RESTRICT;

ALTER TABLE worksite
  DROP CONSTRAINT worksite_company_id_fkey,
  ADD CONSTRAINT worksite_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id) ON DELETE RESTRICT;

-- Index cho cột khoá ngoại chưa có index dẫn đầu bằng đúng tập cột của khoá (cột chọn lọc trước, company_id sau).
CREATE INDEX app_user_employee_id_company_id_fk_idx ON app_user (employee_id, company_id);
CREATE INDEX attendance_adjustment_employee_id_company_id_fk_idx ON attendance_adjustment (employee_id, company_id);
CREATE INDEX attendance_adjustment_target_event_id_company_id_fk_idx ON attendance_adjustment (target_event_id, company_id);
CREATE INDEX attendance_event_employee_id_company_id_fk_idx ON attendance_event (employee_id, company_id);
CREATE INDEX attendance_event_policy_id_company_id_fk_idx ON attendance_event (policy_id, company_id);
CREATE INDEX attendance_event_shift_assignment_id_company_id_fk_idx ON attendance_event (shift_assignment_id, company_id);
CREATE INDEX attendance_event_worksite_id_company_id_fk_idx ON attendance_event (worksite_id, company_id);
CREATE INDEX attendance_event_voided_by_adjustment_id_company_id_fk_idx ON attendance_event (voided_by_adjustment_id, company_id);
CREATE INDEX cms_revision_author_user_id_company_id_fk_idx ON cms_revision (author_user_id, company_id);
CREATE INDEX cms_revision_page_id_company_id_fk_idx ON cms_revision (page_id, company_id);
CREATE INDEX cms_revision_reviewer_user_id_company_id_fk_idx ON cms_revision (reviewer_user_id, company_id);
CREATE INDEX comment_company_id_fk_idx ON comment (company_id);
CREATE INDEX department_branch_id_company_id_fk_idx ON department (branch_id, company_id);
CREATE INDEX department_parent_id_company_id_fk_idx ON department (parent_id, company_id);
CREATE INDEX document_version_document_id_company_id_fk_idx ON document_version (document_id, company_id);
CREATE INDEX document_version_file_id_company_id_fk_idx ON document_version (file_id, company_id);
CREATE INDEX employment_history_department_id_company_id_fk_idx ON employment_history (department_id, company_id);
CREATE INDEX employment_history_employee_id_company_id_fk_idx ON employment_history (employee_id, company_id);
CREATE INDEX employment_history_manager_employee_id_company_id_fk_idx ON employment_history (manager_employee_id, company_id);
CREATE INDEX inquiry_assignee_user_id_company_id_fk_idx ON inquiry (assignee_user_id, company_id);
CREATE INDEX inquiry_history_inquiry_id_company_id_fk_idx ON inquiry_history (inquiry_id, company_id);
CREATE INDEX inquiry_route_assignee_user_id_company_id_fk_idx ON inquiry_route (assignee_user_id, company_id);
CREATE INDEX job_application_job_page_id_company_id_fk_idx ON job_application (job_page_id, company_id);
CREATE INDEX leave_ledger_employee_id_company_id_fk_idx ON leave_ledger (employee_id, company_id);
CREATE INDEX leave_ledger_leave_request_id_company_id_fk_idx ON leave_ledger (leave_request_id, company_id);
CREATE INDEX leave_ledger_leave_type_id_company_id_fk_idx ON leave_ledger (leave_type_id, company_id);
CREATE INDEX leave_request_employee_id_company_id_fk_idx ON leave_request (employee_id, company_id);
CREATE INDEX leave_request_leave_type_id_company_id_fk_idx ON leave_request (leave_type_id, company_id);
CREATE INDEX milestone_project_id_company_id_fk_idx ON milestone (project_id, company_id);
CREATE INDEX ot_request_employee_id_company_id_fk_idx ON ot_request (employee_id, company_id);
CREATE INDEX ot_request_policy_id_company_id_fk_idx ON ot_request (policy_id, company_id);
CREATE INDEX plan_baseline_project_id_company_id_fk_idx ON plan_baseline (project_id, company_id);
CREATE INDEX project_manager_employee_id_company_id_fk_idx ON project (manager_employee_id, company_id);
CREATE INDEX project_member_employee_id_company_id_fk_idx ON project_member (employee_id, company_id);
CREATE INDEX project_member_project_id_company_id_fk_idx ON project_member (project_id, company_id);
CREATE INDEX reconciliation_note_employee_id_company_id_fk_idx ON reconciliation_note (employee_id, company_id);
CREATE INDEX role_grant_user_id_company_id_fk_idx ON role_grant (user_id, company_id);
CREATE INDEX shift_assignment_employee_id_company_id_fk_idx ON shift_assignment (employee_id, company_id);
CREATE INDEX shift_assignment_shift_template_id_company_id_fk_idx ON shift_assignment (shift_template_id, company_id);
CREATE INDEX shift_assignment_worksite_id_company_id_fk_idx ON shift_assignment (worksite_id, company_id);
CREATE INDEX task_project_id_company_id_fk_idx ON task (project_id, company_id);
CREATE INDEX task_responsible_employee_id_company_id_fk_idx ON task (responsible_employee_id, company_id);
CREATE INDEX task_reviewer_employee_id_company_id_fk_idx ON task (reviewer_employee_id, company_id);
CREATE INDEX task_work_package_id_company_id_fk_idx ON task (work_package_id, company_id);
CREATE INDEX task_collaborator_employee_id_fk_idx ON task_collaborator (employee_id);
CREATE INDEX task_dependency_predecessor_id_company_id_fk_idx ON task_dependency (predecessor_id, company_id);
CREATE INDEX task_dependency_successor_id_company_id_fk_idx ON task_dependency (successor_id, company_id);
CREATE INDEX task_evidence_task_id_company_id_fk_idx ON task_evidence (task_id, company_id);
CREATE INDEX task_history_task_id_company_id_fk_idx ON task_history (task_id, company_id);
CREATE INDEX timesheet_entry_employee_id_company_id_fk_idx ON timesheet_entry (employee_id, company_id);
CREATE INDEX timesheet_entry_project_id_company_id_fk_idx ON timesheet_entry (project_id, company_id);
CREATE INDEX timesheet_entry_task_id_company_id_fk_idx ON timesheet_entry (task_id, company_id);
CREATE INDEX work_package_parent_id_company_id_fk_idx ON work_package (parent_id, company_id);
CREATE INDEX work_package_project_id_company_id_fk_idx ON work_package (project_id, company_id);
CREATE INDEX worksite_branch_id_company_id_fk_idx ON worksite (branch_id, company_id);

-- DB-PERF-001: hàng chờ duyệt (đường nóng) lọc theo status = 'pending' — index riêng phần đang chờ (nhỏ, không quét cả bảng).
CREATE INDEX leave_request_pending_idx ON leave_request (company_id, created_at) WHERE status = 'pending';
CREATE INDEX ot_request_pending_idx ON ot_request (company_id, created_at) WHERE status = 'pending';
CREATE INDEX attendance_adjustment_pending_idx ON attendance_adjustment (company_id, created_at) WHERE status = 'pending';
