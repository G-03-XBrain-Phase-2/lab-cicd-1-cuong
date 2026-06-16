# Giải Thích Chi Tiết File Cấu Hình Rollout (`rollout.yaml`)

File này cấu hình tài nguyên `Rollout` của Argo Rollouts để triển khai ứng dụng. Cấu trúc của nó tương đồng đến 99% so với một `Deployment` tiêu chuẩn trong Kubernetes, giúp dễ dàng chuyển đổi và quản lý.

Dưới đây là giải thích chi tiết ý nghĩa của từng dòng và từng cụm cấu hình:

---

## 1. Định Nghĩa Tài Nguyên (Resource Definition)

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: prometheus-canary-demo
```

*   **`apiVersion: argoproj.io/v1alpha1`**: Khai báo nhóm API và phiên bản của Argo Rollouts (thay vì dùng `apps/v1` của Deployment mặc định). Chỉ khi dùng API này, Kubernetes mới hiểu các thuộc tính nâng cao của Argo.
*   **`kind: Rollout`**: Chỉ định loại tài nguyên là `Rollout` (thay vì `Deployment`) để bộ điều khiển (Controller) của Argo Rollouts tiếp nhận và xử lý.
*   **`metadata.name: prometheus-canary-demo`**: Tên định danh duy nhất của ứng dụng này trong cụm Kubernetes.

---

## 2. Phần Đặc Tả Rollout (Rollout Specification)

```yaml
spec:
  replicas: 1
  selector:
    matchLabels:
      app: prometheus-canary-demo
```

*   **`spec`**: Chứa toàn bộ cấu hình đặc tả trạng thái mong muốn của ứng dụng.
*   **`replicas: 1`**: Số lượng bản sao (Pod) chạy đồng thời. (Ở môi trường Production thực tế thường tăng lên `3` hoặc `5` để đảm bảo tính sẵn sàng cao).
*   **`selector.matchLabels`**: Bộ lọc giúp bộ điều khiển Rollout xác định chính xác những Pod nào thuộc quyền quản lý của nó. Ở đây, nó sẽ quản lý mọi Pod có nhãn là `app: prometheus-canary-demo`.

---

## 3. Cụm Thiết Kế Pod Mẫu (Pod Template)

```yaml
  template:
    metadata:
      labels:
        app: prometheus-canary-demo
```

*   **`template`**: Bản thiết kế mẫu để tạo ra các Pod chạy ứng dụng.
*   **`metadata.labels`**: Gắn nhãn (label) cho Pod khi được khởi tạo. Nhãn này **bắt buộc phải trùng khớp** với bộ lọc ở phần `selector.matchLabels` phía trên thì Rollout mới có thể liên kết và quản lý Pod đó.

---

## 4. Cấu Hình Container Chạy Bên Trong Pod

```yaml
    spec:
      containers:
        - name: app
          image: prometheus-canary-demo-placeholder:latest
          ports:
            - containerPort: 3000
              name: http
```

*   **`spec.containers`**: Khai báo danh sách các container chạy bên trong một Pod.
*   **`name: app`**: Đặt tên định danh cho container này là `app`.
*   **`image: prometheus-canary-demo-placeholder:latest`**: Docker Image dùng để khởi chạy container (ở đây là một placeholder tạm thời, pipeline CI/CD sẽ tự động cập nhật tag image thật theo mã băm SHA của commit khi có code mới).
*   **`ports.containerPort: 3000`**: Cổng (port) mà ứng dụng NodeJS bên trong container đang lắng nghe và xử lý traffic.
*   **`ports.name: http`**: Đặt tên cho cổng này là `http` để dễ dàng tham chiếu ở các cấu hình khác (như Service).

---

## 5. Cấu Hình Biến Môi Trường (Environment Variables)

```yaml
          envFrom:
            - configMapRef:
                name: app-config
```

*   **`envFrom`**: Nạp hàng loạt các cặp Key-Value từ cấu hình **`ConfigMap`** (ở đây là `app-config`) vào thẳng các biến môi trường của container để ứng dụng NodeJS có thể đọc được (ví dụ: `VERSION`, `ENVIRONMENT`).

```yaml
          env:
            - name: DATABASE_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: db-secret
                  key: DATABASE_PASSWORD
```

*   **`env`**: Khai báo riêng một biến môi trường cụ thể có tên `DATABASE_PASSWORD`.
*   **`valueFrom.secretKeyRef`**: Thay vì ghi đè mật khẩu rõ ràng (clear text) trong code gây mất an toàn, giá trị sẽ được đọc bảo mật từ tài nguyên **`Secret`** có tên `db-secret` với khóa là `DATABASE_PASSWORD`.

---

## 6. Cơ Chế Kiểm Tra Sức Khỏe Ứng Dụng (Readiness Probe)

```yaml
          readinessProbe:
            httpGet:
              path: /healthz
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
```

*   **`readinessProbe`**: Cơ chế kiểm tra mức độ sẵn sàng của ứng dụng. K8s sẽ gửi request tới đây để quyết định xem có nên cho phép Pod nhận lưu lượng truy cập từ người dùng hay không.
*   **`httpGet`**: Phương thức kiểm tra bằng cách gửi request HTTP GET.
    *   **`path: /healthz`**: Endpoint được gọi để kiểm tra sức khỏe ứng dụng (ứng dụng NodeJS cần code sẵn endpoint này và trả về HTTP 200).
    *   **`port: 3000`**: Cổng gửi request kiểm tra sức khỏe.
*   **`initialDelaySeconds: 5`**: Thời gian chờ 5 giây sau khi container khởi động rồi mới gửi request kiểm tra lần đầu tiên (để tránh lỗi do ứng dụng chưa kịp khởi động xong).
*   **`periodSeconds: 5`**: Tần suất thực hiện kiểm tra sức khỏe là mỗi 5 giây một lần.
    *   *Quy tắc hoạt động:* Nếu ứng dụng phản hồi HTTP Status trong khoảng `200` - `399`, Pod được đánh dấu là **Ready** (Sẵn sàng nhận traffic). Nếu lỗi (ví dụ HTTP 500) hoặc không phản hồi quá số lần quy định, Pod sẽ bị loại khỏi danh sách phục vụ traffic để tránh gây lỗi cho người dùng.
