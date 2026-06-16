# Nhật Ký Sửa Lỗi Hạ Tầng & Triển Khai (Infrastructure & Deployment Troubleshooting Log)

Tài liệu này tổng hợp lại toàn bộ các lỗi liên quan đến cấu hình Kubernetes, Kustomize, ArgoCD và Sealed Secrets mà chúng ta đã gặp trong quá trình cài đặt, cùng với nguyên nhân và giải pháp khắc phục chi tiết.

---

## 1. Lỗi Cấu Hình Khởi Tạo Application (`strict decoding error`)

### ❌ Triệu chứng:
Khi chạy lệnh `kubectl apply` cho file Application (`argo-app-dev.yaml` hoặc `argo-app-prod.yaml`), hệ thống báo lỗi BadRequest:
```text
Application in version "v1alpha1" cannot be handled as a Application: strict decoding error: unknown field "spec.syncPolicy.createNamespace"
```

### 🔍 Nguyên nhân:
Trong schema CRD của ArgoCD Application, thuộc tính tự động tạo namespace `createNamespace: true` **không được phép viết trực tiếp** dưới dạng boolean trực thuộc `syncPolicy`.

### 🛠️ Cách khắc phục:
Chuyển thuộc tính này vào danh sách tùy chọn cấu hình `syncOptions` dưới dạng một phần tử chuỗi:
```yaml
# Thay vì:
# syncPolicy:
#   createNamespace: true

# Sửa thành:
syncPolicy:
  automated:
    prune: true
    selfHeal: true
  syncOptions:
    - CreateNamespace=true
```

---

## 2. Lỗi Phân Giải Nhánh của ArgoCD (`Unable to load data: revision HEAD must be resolved`)

### ❌ Triệu chứng:
Ứng dụng trên ArgoCD bị treo ở trạng thái `Unknown` / `ComparisonError` kèm dòng thông báo:
```text
Unable to load data: revision HEAD must be resolved
```

### 🔍 Nguyên nhân:
Do cơ chế **lưu bộ nhớ đệm (Cache)** của ArgoCD. Khi file Application được apply lần đầu tiên lúc kho Git GitHub chưa có code hoặc chưa cấu hình đúng, ArgoCD sẽ cache lại lỗi kết nối đó trong 3 phút. Kể cả sau khi bạn đã sửa đúng file và push lên Git, ArgoCD vẫn đọc cache cũ và báo lỗi.

### 🛠️ Cách khắc phục:
1. Sửa lại đường dẫn `repoURL` cho chuẩn (thêm đuôi `.git` cho an toàn) và chỉ định cụ thể nhánh chính là `main`:
   ```yaml
   repoURL: 'https://github.com/G-03-XBrain-Phase-2/lab-cicd-1-cuong.git'
   targetRevision: main
   ```
2. Thực hiện xóa cache thủ công trên giao diện Web UI của ArgoCD bằng cách: Bấm vào nút tam giác nhỏ bên cạnh nút **`REFRESH`** -> chọn **`HARD REFRESH`** để bắt buộc ArgoCD xóa cache và kéo lại thông tin mới nhất từ GitHub.

---

## 3. Lỗi Kustomize Biên Dịch Môi Trường Prod (`no resource matches strategic merge patch`)

### ❌ Triệu chứng:
Tiến trình đồng bộ của ArgoCD báo lỗi biên dịch Kustomize:
```text
failed exit status 1: Error: no resource matches strategic merge patch "Service.v1.[noGrp]/prometheus-canary-demo-stable.[noNs]"
```

### 🔍 Nguyên nhân:
Trong file `kustomize/overlays/prod/patches.yaml`, chúng ta khai báo thêm 2 Service mới (`stable` và `canary`). 
Vì file này được liên kết dưới mục `patches:` của Kustomize, Kustomize sẽ hiểu đây là các bản vá và cố gắng tìm các tài nguyên trùng tên trong thư mục gốc (`base/`) để đắp vá. Do 2 Service này là tài nguyên hoàn toàn mới (không tồn tại ở `base/`), Kustomize báo lỗi biên dịch vì không tìm thấy đối tượng gốc để vá.

### 🛠️ Cách khắc phục:
Tách các tài nguyên mới ra khỏi file patches và đưa vào phần tài nguyên khai báo mới (`resources`):
1. Tách 2 Service này ra một file mới tên là `services.yaml` nằm trong thư mục `overlays/prod/`.
2. Xóa 2 Service đó khỏi file `patches.yaml` (chỉ để lại cấu hình patch của `Rollout`).
3. Khai báo thêm file `services.yaml` vào danh sách `resources` trong file `kustomization.yaml` của môi trường prod:
   ```yaml
   resources:
     - ../../base
     - services.yaml
     - analysis.yaml
     - alerts.yaml
     - sealed-secret.yaml
   ```

---

## 4. Lỗi Chiến Lược Rollout ở Môi Trường DEV (`missing field canary or blueGreen`)

### ❌ Triệu chứng:
Ứng dụng `canary-demo-dev` bị rơi vào trạng thái `Degraded` (InvalidSpec) kèm lỗi:
```text
The Rollout "prometheus-canary-demo" is invalid: spec.strategy.strategy: Required value: Rollout has missing field '.spec.strategy.canary or .spec.strategy.blueGreen'
```

### 🔍 Nguyên nhân:
Tài nguyên `Rollout` của Argo Rollouts bắt buộc phải khai báo một trong hai chiến lược nâng cao là `canary` hoặc `blueGreen` dưới mục `spec.strategy`. Cấu hình ghi đè strategy ở Dev thành `rollingUpdate` (của Deployment thường) là không hợp lệ đối với schema của `Rollout`.

### 🛠️ Cách khắc phục:
Sửa file `kustomize/overlays/dev/patches.yaml` để sử dụng chiến lược `canary` nhưng không khai báo các bước (steps) để nó tự động chạy RollingUpdate mặc định của K8s mà vẫn đúng chuẩn schema:
```yaml
# Thay vì:
# strategy:
#   canary: null
#   rollingUpdate: ...

# Sửa thành:
spec:
  replicas: 1
  strategy:
    canary:
      steps: []
```

---

## 5. Lỗi Phân Tích Lỗi Canary Vô Hạn ở PROD (`metric runs indefinitely`)

### ❌ Triệu chứng:
Ứng dụng `canary-demo-prod` bị báo lỗi `Degraded` (InvalidSpec):
```text
AnalysisTemplate prometheus-error-rate-analysis has metric error-rate which runs indefinitely. Invalid value for count: <nil>
```

### 🔍 Nguyên nhân:
Khi tích hợp tự động phân tích độ ổn định vào các bước Canary (`steps.analysis`), Argo Rollouts yêu cầu quá trình phân tích này phải có giới hạn điểm dừng (số lần đo đạc - count) để quyết định xem có đi tiếp hay rollback. Cấu hình cũ trong `analysis.yaml` chỉ khai báo đo đạc mỗi `30s` (interval) mà không khai báo `count` khiến nó chạy vô tận, dẫn đến lỗi xác thực đặc tả.

### 🛠️ Cách khắc phục:
Bổ sung tham số `count` để giới hạn số lần thực thi của tiến trình đo đạc trong file `kustomize/overlays/prod/analysis.yaml`:
```yaml
  metrics:
    - name: error-rate
      interval: 30s
      count: 3 # Đo đạc 3 lần (tổng cộng 1.5 phút) rồi dừng và đưa ra kết quả
      successCondition: result[0] < 0.05
```

---

## 6. Lỗi Cú Pháp Tắt Băm ConfigMap Kustomize (`unknown field "disableNameHash"`)

### ❌ Triệu chứng:
Khi chạy Kustomize build trong pipeline hoặc trên máy, bộ biên dịch báo lỗi:
```text
invalid Kustomization: json: unknown field "disableNameHash"
```

### 🔍 Nguyên nhân:
Trong cấu hình Kustomize, từ khóa đúng để vô hiệu hóa việc sinh mã băm hậu tố cho tên ConfigMap/Secret là **`disableNameSuffixHash`** chứ không phải `disableNameHash` (thiếu từ `Suffix`).

### 🛠️ Cách khắc phục:
Cập nhật đúng từ khóa trong các file `kustomization.yaml`:
```yaml
# Thay vì:
# generatorOptions:
#   disableNameHash: true

# Sửa thành:
generatorOptions:
  disableNameSuffixHash: true
```

---

## 7. Lỗi Sealed Secret Sai Namespace (`secret "db-secret" not found` trên Prod)

### ❌ Triệu chứng:
Ứng dụng trên môi trường `prod` báo lỗi `secret "db-secret" not found` mặc dù file `sealed-secret.yaml` đã được khai báo và deploy thành công trên cụm.

### 🔍 Nguyên nhân:
Trong file `sealed-secret.yaml` bị gán cứng trường `namespace: default` (do file `secret-raw.yaml` ban đầu được tạo với namespace default). Dẫn đến việc Secret sau khi giải mã bị đẩy vào namespace `default`, trong khi Pod Rollout của môi trường prod lại tìm kiếm Secret trong namespace `prod`.

> [!CAUTION]
> Một Sealed Secret được mã hóa đi kèm chữ ký xác thực gán chặt với Tên và Namespace. Do đó bạn **không thể** sửa bằng tay trường `namespace` trong file `sealed-secret.yaml` (sẽ gây lỗi giải mã).

### 🛠️ Cách khắc phục:
Bắt buộc phải mã hóa lại Secret bằng lệnh `kubeseal` cho đúng namespace:
1. Tạo lại file `secret-raw.yaml` với metadata chỉ định đúng namespace `prod`.
2. Chạy lại lệnh mã hóa `kubeseal` để tạo ra file `sealed-secret.yaml` mới.
3. Xóa file raw và push file `sealed-secret.yaml` mới lên GitHub.

---

## 8. Lỗi Phân Tích Lỗi Canary Thất Bại Do Sai DNS Prometheus (`no such host` ở AnalysisRun)

### ❌ Triệu chứng:
Ứng dụng trên môi trường `prod` bị báo lỗi `Degraded` trong quá trình deploy Canary, với thông báo lỗi từ `AnalysisRun`:
```text
dial tcp: lookup prometheus-kube-prometheus-prometheus.monitoring.svc.cluster.local on 10.96.0.10:53: no such host
```

### 🔍 Nguyên nhân:
Địa chỉ DNS của Prometheus được cấu hình cứng trong file `analysis.yaml` không trùng khớp với tên Service thực tế chạy trong cụm K8s.
*   Địa chỉ cấu hình: `prometheus-kube-prometheus-prometheus.monitoring.svc.cluster.local`
*   Địa chỉ thực tế (do tên Helm Release của bạn là `kube-prometheus-stack`): `kube-prometheus-stack-prometheus.monitoring.svc.cluster.local`

### 🛠️ Cách khắc phục:
Chỉnh sửa lại trường `address` trong file `kustomize/overlays/prod/analysis.yaml` để trỏ đúng tên Service thực tế:
```yaml
# Thay vì:
# address: http://prometheus-kube-prometheus-prometheus.monitoring.svc.cluster.local:9090

# Sửa thành:
address: http://kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090
```

