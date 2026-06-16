# Q&A: Kiến Thức GitOps CI/CD & SRE (Canary Lab)

Tài liệu này tổng hợp toàn bộ câu hỏi và giải đáp chi tiết trong quá trình triển khai Lab CI/CD, GitOps và Prometheus Canary trên Kubernetes.

---

### 1. Rollout khác gì với Deployment trong Kubernetes?

Mặc dù tài nguyên **Deployment** mặc định của Kubernetes hoạt động rất tốt, nhưng nó chỉ hỗ trợ chiến lược cập nhật cơ bản là **RollingUpdate** (thay thế dần Pod cũ bằng Pod mới). Cách này có một số hạn chế lớn trong môi trường Production:
* **Không kiểm soát được lưu lượng:** Không thể định tuyến thử nghiệm (ví dụ: chỉ cho 5% người dùng dùng thử bản mới).
* **Không có cơ chế tự động rút lui (Auto-Rollback):** Khi bản mới bị lỗi (HTTP 500, phản hồi chậm), Deployment không tự động phát hiện để quay về bản cũ mà cần con người can thiệp thủ công.

**Argo Rollout** ra đời để thay thế hoàn toàn Deployment. Nó mang lại khả năng triển khai ứng dụng an toàn và thông minh hơn nhờ tích hợp chặt chẽ với các công cụ giám sát (như Prometheus, Grafana) để tự động hóa quá trình xác minh và rollback phiên bản mới khi gặp sự cố.

---

### 2. Có bao nhiêu chiến lược triển khai chính trong Argo Rollouts?

Khi cấu hình `kind: Rollout`, bạn có hai chiến lược triển khai chính tại phần `spec.strategy`:

1. **Canary (Triển khai kiểu "Chim hoàng yến" - dùng trong bài Lab này):**
   * **Cách hoạt động:** Chia nhỏ lưu lượng truy cập (traffic) của khách hàng thành nhiều bước để hướng tới bản mới. Ví dụ: Chuyển 20% traffic sang bản mới, tạm dừng 1 phút chạy phân tích lỗi. Nếu tốt, tăng lên 50% traffic rồi mới chuyển hoàn toàn 100% để thay thế bản cũ.
   * **Ưu điểm:** Giảm thiểu tối đa phạm vi ảnh hưởng (Blast Radius) nếu bản cập nhật có lỗi nghiêm trọng.

2. **Blue-Green (Triển khai Xanh - Đỏ):**
   * **Cách hoạt động:** Chạy song song hoàn toàn 2 phiên bản ứng dụng độc lập: Môi trường Blue (Stable - phục vụ 100% người dùng thực) và môi trường Green (New - bản mới được deploy để test nội bộ). Sau khi chạy các bài test tự động trên Green đạt yêu cầu, Argo Rollout sẽ chuyển hướng (switch) 100% traffic từ Blue sang Green lập tức.
   * **Ưu điểm:** Quay xe về bản cũ gần như ngay lập tức (instant) nếu bản mới phát sinh lỗi sau khi chuyển đổi.

---

### 3. File `kustomization.yaml` dùng để làm gì và giải quyết vấn đề gì?

* **Ý nghĩa:** Đây là tệp tin cấu hình trung tâm của Kustomize. Nó định nghĩa danh sách các file tài nguyên gốc (`resources`), các cấu hình ghi đè (`patches`), cơ chế tự sinh cấu hình (`configMapGenerator`, `secretGenerator`), và các tiền tố/nhãn chung (`namespace`, `commonLabels`).
* **Vấn đề giải quyết:**
  * **Tránh trùng lặp mã nguồn (DRY - Don't Repeat Yourself):** Thay vì phải copy toàn bộ file YAML K8s cho mỗi môi trường (dev, prod) và chỉnh sửa thủ công, bạn chỉ cần một thư mục `base` chứa cấu hình gốc. Thư mục của các môi trường con chỉ cần chứa file `kustomization.yaml` để khai báo các phần thay đổi đè lên `base`.
  * **Quản lý tập trung:** Gom nhóm tất cả tài nguyên rời rạc của một ứng dụng thành một khối để deploy nhanh chóng chỉ với một lệnh (`kubectl apply -k`).

---

### 4. Dòng cấu hình `patches: - path: patches.yaml` trong Kustomize nghĩa là gì?

Hai dòng này yêu cầu Kustomize áp dụng tệp tin ghi đè (`patches.yaml`) để thay đổi cấu hình gốc (`base`) cho phù hợp với từng môi trường cụ thể.

**Cách hoạt động thực tế:**
1. Kustomize đọc file cấu hình gốc (ví dụ: `rollout.yaml` ở thư mục `base`).
2. Nó đọc tiếp file `patches.yaml` ở thư mục môi trường con (ví dụ: `dev/`).
3. Nó đối chiếu tài nguyên có cùng `apiVersion`, `kind`, và `metadata.name` (ở đây là `kind: Rollout` tên `prometheus-canary-demo`).
4. Kustomize sẽ lấy các giá trị trong `patches.yaml` để đè (hoặc bổ sung) vào cấu hình gốc. Ví dụ ở `dev`, file patch yêu cầu thiết lập strategy là `rollingUpdate` và xóa cấu hình `canary: null` để tiết kiệm tài nguyên chạy thử.

---

### 5. Bitnami Sealed Secrets và `kubeseal` CLI khác nhau ra sao?

Hai thành phần này hoạt động theo mô hình Khóa bất đối xứng (Asymmetric Cryptography) tương tự SSH Key (gồm Public Key và Private Key), chia rõ nhiệm vụ giữa Laptop cá nhân (Client) và Cụm K8s (Server):

1. **`kubeseal` CLI (Chỉ dùng để mã hóa trên laptop cá nhân):**
   * **Nhiệm vụ:** Mã hóa một chiều (Encrypt).
   * **Cách hoạt động:** Kết nối vào cụm K8s để xin Public Key (Khóa công khai) từ Controller, sau đó mã hóa file mật khẩu rõ (`secret-raw.yaml`) thành file đã mã hóa (`sealed-secret.yaml`).
   * **Bảo mật:** Dù hacker lấy được file `sealed-secret.yaml` trên GitHub, họ cũng không có cách nào giải mã ngược lại vì không giữ Private Key.

2. **Sealed Secrets Controller (Chỉ dùng để giải mã trong cụm K8s):**
   * **Nhiệm vụ:** Giải mã tự động (Decrypt).
   * **Cách hoạt động:** Chạy ẩn trong cụm K8s, nắm giữ Private Key (Khóa bí mật). Khi ArgoCD đẩy file `sealed-secret.yaml` lên cụm, Controller dùng Private Key giải mã và tự động tạo ra một tài nguyên Kubernetes Secret thông thường (`db-secret`) để ứng dụng đọc.

---

### 6. Sự khác biệt giữa 3 thành phần cấu hình Alertmanager: Helm Values, Secret, và AlertmanagerConfig

1. **Helm Values (Cấu hình toàn cục lúc cài đặt):**
   * Được định nghĩa trong file `values.yaml` khi cài đặt chart `kube-prometheus-stack`.
   * Dùng để thiết lập cấu hình hệ thống lớn (Global): Cấu hình SMTP email gửi đi, webhook Slack mặc định, và cây định tuyến cảnh báo (routing tree) cho toàn hệ thống.

2. **Secret `alertmanager-prometheus-kube-prometheus-alertmanager` (Cấu hình thực thi):**
   * Là một K8s Secret chứa file cấu hình `alertmanager.yaml` thực tế đang chạy trong Pod.
   * Nó được sinh ra tự động từ cấu hình Helm. Tuy nhiên, trong GitOps, nếu bạn muốn ghi đè cấu hình Alertmanager mà không muốn nâng cấp (upgrade) Helm chart, bạn có thể chỉnh sửa trực tiếp Secret này.

3. **AlertmanagerConfig (Custom Resource - Cấu hình cấp Namespace):**
   * Là một tài nguyên K8s chuẩn (CRD) do Prometheus Operator cung cấp.
   * Cho phép các team phát triển tự định nghĩa luồng nhận cảnh báo của riêng họ trong namespace tương ứng (ví dụ: Team A nhận tin nhắn qua kênh Slack A, Team B nhận qua kênh Slack B) mà không cần quyền can thiệp vào cấu hình hệ thống chung của SRE.

---

### 7. Làm sao `alerts.yaml` và `kube-prometheus-stack.yaml` nhận diện được nhau?

Việc này dựa trên **Cơ chế tự động phát hiện (Auto-Discovery) bằng nhãn (Labels)**:
* Khi cài đặt Prometheus thông qua Helm (`kube-prometheus-stack`), Prometheus được thiết lập bộ lọc `ruleSelector` để chỉ quét các file rule có nhãn chỉ định (mặc định là `release: prometheus`).
* Trong file `alerts.yaml`, ta khai báo nhãn khớp 100%:
  ```yaml
  metadata:
    labels:
      role: alert-rules
      release: prometheus
  ```
* Prometheus Operator liên tục quét cụm K8s. Khi thấy bất kỳ tài nguyên `PrometheusRule` nào có nhãn `release: prometheus`, nó sẽ tự động nạp các luật cảnh báo đó vào cấu hình chạy của Prometheus Server.

---

### 8. Pull Request và `git merge` có gì khác nhau?

* **`git merge`:** Là một **câu lệnh kỹ thuật** của Git dùng để gộp lịch sử commit của nhánh này vào nhánh khác.
* **Pull Request (PR) / Merge Request (MR):** Là một **quy trình cộng tác trên giao diện Web** (GitHub/GitLab) được xây dựng xung quanh lệnh `git merge`. PR cho phép các lập trình viên:
  - Xem trước các thay đổi code (Code Diff).
  - Viết nhận xét, thảo luận, review code.
  - Chạy các bài test tự động (CI check) xem code mới có làm hỏng hệ thống không.
  - Yêu cầu Lead duyệt (Approve) trước khi gộp. Khi bấm nút gộp trên giao diện Web, hệ thống mới thực tế chạy lệnh `git merge` dưới nền.

---

### 9. SRE là viết tắt của cái gì?

* **SRE** viết tắt của **Site Reliability Engineering** (Kỹ nghệ Tin cậy Hệ thống).
* Đây là phương pháp do Google phát triển, ứng dụng các nguyên lý của Kỹ thuật phần mềm (Software Engineering) vào các bài toán Vận hành hệ thống (Operations) để xây dựng hệ thống phần mềm có tính sẵn sàng cao, tin cậy cao và khả năng mở rộng tốt.

---

### 10. Application in Application (App-of-Apps) và ApplicationSet trong ArgoCD khác gì nhau? Thực tế dùng loại nào?

* **Application in Application (App-of-Apps):**
  * **Khái niệm:** Dùng một ứng dụng ArgoCD gốc (Root App) quản lý và trỏ tới một thư mục Git chứa các file định nghĩa ứng dụng con (Child Apps).
  * **Đặc điểm:** Phải khai báo thủ công từng file cấu hình cho mỗi ứng dụng con. Phù hợp với dự án quy mô vừa và nhỏ.
* **ApplicationSet:**
  * **Khái niệm:** Một công cụ tạo hàng loạt ứng dụng ArgoCD tự động dựa trên các quy tắc (Generators) và biểu mẫu (Templates).
  * **Đặc điểm:** Tự động hóa hoàn toàn. Ví dụ: Nó tự động quét thư mục Git, hễ thấy thư mục mới là tự sinh ra một ứng dụng ArgoCD tương ứng mà bạn không cần viết thêm YAML. Phù hợp cho môi trường lớn (đa cụm, đa môi trường).
* **Thực tế:** **ApplicationSet** được ưu tiên sử dụng nhiều hơn trong thực tế nhờ khả năng tự động hóa vượt trội và giảm thiểu thao tác thủ công của DevOps.

---

### 11. Tại sao base đã có `kustomization.yaml` nhưng dev/prod vẫn cần lại file đó?

* **Kế thừa và Tùy biến:** `base` đóng vai trò là bản thiết kế tiêu chuẩn. File `kustomization.yaml` ở `base` gom nhóm các file gốc.
* Các môi trường con (`dev`, `prod`) cần file `kustomization.yaml` riêng để chỉ định đường dẫn kế thừa từ base (`../../base`), đồng thời khai báo các tệp tin tùy biến riêng cho môi trường đó (chẳng hạn như tăng replicas ở prod, thêm cấu hình Canary, nạp ServiceMonitor, hoặc SealedSecrets).

---

### 12. Alert và AnalysisRun có hoạt động song song không? Có cái nào phụ thuộc cái nào không?

Cả hai chạy **song song và độc lập hoàn toàn**, cùng lấy metrics từ Prometheus nhưng phục vụ mục đích khác nhau:
* **AnalysisRun (Argo Rollouts):** Chỉ chạy lúc đang deploy (release ứng dụng). Nó kiểm tra xem bản code mới có lỗi không. Nếu lỗi, nó **tự động Rollback** ngay lập tức. Xong việc deploy nó sẽ tự hủy.
* **Alerting (Prometheus Alertmanager):** Chạy liên tục **24/7**. Nó giám sát sức khỏe toàn hệ thống. Nếu vi phạm SLO (lỗi kéo dài), nó sẽ **gửi cảnh báo (Email/Slack)** để gọi kỹ sư trực ca vào xử lý, chứ không tự động rollback.

---

### 13. Ý nghĩa của việc tạo 2 Service riêng biệt (stable và canary) ở file `services.yaml` và `patches.yaml` của Prod là gì?

Việc tách biệt thành hai Service `prometheus-canary-demo-stable` và `prometheus-canary-demo-canary` nhằm giải quyết 2 bài toán:

1. **Đo lường metrics chính xác của bản mới (Prometheus Analysis):**
   * Nhờ tách Service Canary riêng, Prometheus có thể lọc chính xác metrics (Request, Errors) phát sinh từ các Pod chạy bản mới đang test (thông qua Service `prometheus-canary-demo-canary`), không bị trộn lẫn với bản cũ ổn định.
   * Nếu có lỗi phát sinh từ bản mới, hệ thống phân tích sẽ phát hiện chính xác và tự động rollback.

2. **Hỗ trợ định tuyến thông minh (Traffic Splitting):**
   * Giúp các bộ điều khiển Ingress hoặc Service Mesh có điểm đích (Service Target) rõ ràng để phân chia tỷ lệ traffic (ví dụ: 80% vào Stable và 20% vào Canary).
