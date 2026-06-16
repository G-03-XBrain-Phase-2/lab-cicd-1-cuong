# Nhật Ký Sửa Lỗi Git (Git Errors & Workflow Log)

Tài liệu này tổng hợp lại các lỗi Git thường gặp trong quy trình làm việc GitOps và CI/CD, giải thích nguyên nhân và đưa ra các lệnh xử lý chuẩn xác.

---

## 1. Lỗi Đẩy Code Bị Từ Chối Do Lệch Nhánh (`rejected non-fast-forward`)

### ❌ Triệu chứng:
Khi chạy lệnh `git push origin main` (hoặc push lên nhánh dev), Git từ chối đẩy code lên và báo lỗi:
```text
 ! [rejected]        main -> main (non-fast-forward)
error: failed to push some refs to 'https://github.com/...git'
hint: Updates were rejected because a pushed branch tip is behind its remote counterpart.
```

### 🔍 Nguyên nhân:
Trong luồng GitOps, khi pipeline CI/CD chạy trên GitHub, bot tự động (`github-actions[bot]`) sẽ sửa file (cập nhật tag image) và **tự động commit + push trực tiếp lên GitHub**. 
Điều này làm cho kho chứa trên GitHub xuất hiện những commit mới mà máy cá nhân của bạn chưa có. Nhánh local của bạn bị "chậm hơn" (behind) so với remote, dẫn đến việc Git từ chối cho push đè lên để tránh mất mát dữ liệu.

### 🛠️ Cách khắc phục:
Bạn cần kéo các thay đổi mới nhất từ GitHub về máy và gộp (rebase) các commit của bạn lên trên đầu trước khi push:
```bash
# Kéo và gộp code (rebase)
git pull --rebase origin main

# Nếu có conflict trong quá trình rebase, hãy giải quyết xung đột trong file rồi chạy:
# git add <file-conflict>
# git rebase --continue

# Đẩy code lên GitHub sau khi đã đồng bộ thành công
git push origin main
```

---

## 2. Lỗi Kéo Code Không Có Thông Tin Theo Dõi Nhánh (`no tracking information`)

### ❌ Triệu chứng:
Khi chạy `git pull` hoặc `git pull --rebase` trên nhánh phụ (như `dev`), Git báo lỗi:
```text
There is no tracking information for the current branch.
Please specify which branch you want to rebase against.
```

### 🔍 Nguyên nhân:
Nhánh `dev` ở local của bạn mới được tạo và chưa được thiết lập mối liên kết (tracking) với nhánh `dev` tương ứng trên GitHub (`origin/dev`). Do đó Git không biết phải kéo code từ đâu về.

### 🛠️ Cách khắc phục:
*   **Cách 1: Thiết lập liên kết vĩnh viễn (Khuyên dùng - chỉ cần chạy 1 lần):**
    ```bash
    git branch --set-upstream-to=origin/dev dev
    ```
    Sau lệnh này, bạn chỉ cần gõ `git pull` hoặc `git push` ngắn gọn mà không cần điền thêm gì nữa.
*   **Cách 2: Gõ rõ ràng nguồn kéo code trong lệnh:**
    ```bash
    git pull --rebase origin dev
    ```

---

## 3. Hoàn Tất Quá Trình Giải Quyết Xung Đột Nhánh (`Merge Conflict`)

### ❌ Triệu chứng:
Khi chạy `git merge main` để đồng bộ code từ `main` sang `dev`, hệ thống báo lỗi xung đột:
```text
CONFLICT (content): Merge conflict in kustomize/overlays/dev/kustomization.yaml
Automatic merge failed; fix conflicts and then commit the result.
```
Sau khi bạn mở file sửa hết các xung đột, chạy tiếp `git push` thì vẫn báo lỗi hoặc chạy `git rebase --continue` thì báo `no rebase in progress`.

### 🔍 Nguyên nhân:
Khi gộp nhánh bằng lệnh `git merge` và bị xung đột, sau khi sửa code, bạn phải thực hiện **đóng gói/hoàn tất phiên merge** bằng một Commit Merge đặc biệt. Lệnh `git rebase --continue` chỉ hoạt động khi bạn gộp code bằng lệnh `git rebase` chứ không dùng được cho `git merge`.

### 🛠️ Cách khắc phục:
Chạy tuần tự 3 bước sau để hoàn tất quá trình merge:
```bash
# 1. Add file đã sửa conflict vào staging area
git add kustomize/overlays/dev/kustomization.yaml

# 2. Commit để tạo Merge Commit hoàn tất quá trình gộp nhánh
git commit -m "merge main into dev (resolved conflict)"

# 3. Đẩy nhánh dev đã merge thành công lên GitHub
git push origin dev
```
