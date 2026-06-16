# Lab Nâng Cao: Enterprise GitOps, Secret Management & SRE Alerting (Multi-Env)

Chào mừng bạn đến với bài Lab nâng cao thực chiến. Bài Lab này giải quyết các bài toán thực tế trong doanh nghiệp lớn bằng cách tích hợp sâu các công nghệ:

1.  **Multi-environment GitOps (Dev/Prod)** sử dụng **Kustomize (Bases & Overlays)** để đảm bảo nguyên lý DRY.
2.  **Secret Management** sử dụng **Bitnami Sealed Secrets** để mã hóa an toàn các thông tin nhạy cảm trước khi push lên Git public.
3.  **Advanced Observability & SRE Alerting:** Cấu hình **Prometheus Alertmanager** gửi cảnh báo đến Slack/Discord dựa trên **Error Budget Burn Rate (SLO)** kết hợp thiết kế Grafana Dashboard.

---

## 🏗️ Kiến Trúc Hệ Thống (Repository Structure)
Bạn sẽ tổ chức repo Git của mình theo cấu trúc thư mục sau:

```text
.
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions CI pipeline
├── app/                        # Mã nguồn ứng dụng NodeJS (đã có sẵn)
├── kustomize/
│   ├── base/                   # Cấu hình gốc (Bases)
│   │   ├── rollout.yaml
│   │   ├── service.yaml
│   │   └── kustomization.yaml
│   └── overlays/
│       ├── dev/                # Môi trường Development (Không chạy Canary để tiết kiệm tài nguyên)
│       │   ├── kustomization.yaml
│       │   └── patches.yaml
│       └── prod/               # Môi trường Production (Chạy Canary, Auto-Rollback, SealedSecrets)
│           ├── kustomization.yaml
│           ├── patches.yaml
│           ├── analysis.yaml   # AnalysisTemplate cho Prometheus
│           └── alerts.yaml     # PrometheusRule cho SRE Burn Rate Alerting
```

---

## 🚀 PHẦN 1: Quản lý Cấu hình đa môi trường bằng Kustomize

### 1. Thư mục `kustomize/base/` (Cấu hình gốc)

#### File: `kustomize/base/rollout.yaml`
Đây là định nghĩa gốc của ứng dụng (dùng `Rollout` thay vì `Deployment` để đồng bộ giữa các môi trường).

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: prometheus-canary-demo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: prometheus-canary-demo
  template:
    metadata:
      labels:
        app: prometheus-canary-demo
    spec:
      containers:
        - name: app
          image: prometheus-canary-demo-placeholder:latest
          ports:
            - containerPort: 3000
              name: http
          envFrom:
            - configMapRef:
                name: app-config
          env:
            - name: DATABASE_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: db-secret
                  key: DATABASE_PASSWORD
          readinessProbe:
            httpGet:
              path: /healthz
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
```

#### File: `kustomize/base/service.yaml`
```yaml
apiVersion: v1
kind: Service
metadata:
  name: prometheus-canary-demo
spec:
  ports:
    - port: 80
      targetPort: 3000
      protocol: TCP
      name: http
  selector:
    app: prometheus-canary-demo
```

#### File: `kustomize/base/kustomization.yaml`
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - rollout.yaml
  - service.yaml
```

---

### 2. Thư mục `kustomize/overlays/dev/` (Môi trường Dev)
Môi trường Dev không cần cơ chế Canary phức tạp hay phân tích lỗi để tiết kiệm chi phí chạy Pods và đơn giản hóa việc test nhanh.

#### File: `kustomize/overlays/dev/kustomization.yaml`
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
# Tự động sinh ConfigMap cho Dev
configMapGenerator:
  - name: app-config
    behavior: create
    literals:
      - VERSION="dev-1.0.0"
      - ENVIRONMENT="dev"
patches:
  - path: patches.yaml
```

#### File: `kustomize/overlays/dev/patches.yaml`
Môi trường Dev sẽ ghi đè strategy của Rollout thành `RollingUpdate` thông thường thay vì `Canary`.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: prometheus-canary-demo
spec:
  replicas: 1
  strategy:
    canary: null # Xóa cấu hình Canary
    rollingUpdate:
      maxSurge: "25%"
      maxUnavailable: 0
```

---

### 3. Thư mục `kustomize/overlays/prod/` (Môi trường Prod)
Môi trường Production sẽ cấu hình chạy **Canary**, tích hợp **Prometheus Analysis**, sinh **ServiceMonitor** và cấu hình **SealedSecrets**.

#### File: `kustomize/overlays/prod/kustomization.yaml`
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
  - analysis.yaml
  - alerts.yaml
  - sealed-secret.yaml # Được sinh ra từ bước SealedSecrets ở Phần 2
configMapGenerator:
  - name: app-config
    behavior: create
    literals:
      - VERSION="prod-1.0.0"
      - ENVIRONMENT="production"
patches:
  - path: patches.yaml
```

#### File: `kustomize/overlays/prod/patches.yaml`
Ghi đè cấu hình Production: Tăng số bản sao (replicas: 3), tạo thêm Service Canary riêng biệt, cấu hình chiến lược Canary 20% -> 50% kèm phân tích tự động bằng Prometheus.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: prometheus-canary-demo
spec:
  replicas: 3
  strategy:
    canary:
      stableService: prometheus-canary-demo-stable
      canaryService: prometheus-canary-demo-canary
      steps:
        - setWeight: 20
        - pause: { duration: 1m }
        - setWeight: 50
        - analysis:
            templates:
              - templateName: prometheus-error-rate-analysis
            args:
              - name: service-name
                value: prometheus-canary-demo-canary
        - pause: { duration: 2m }
        - setWeight: 100
---
# Tạo thêm Service Stable riêng cho Prod
apiVersion: v1
kind: Service
metadata:
  name: prometheus-canary-demo-stable
spec:
  ports:
    - port: 80
      targetPort: 3000
      name: http
  selector:
    app: prometheus-canary-demo
---
# Tạo thêm Service Canary riêng cho Prod
apiVersion: v1
kind: Service
metadata:
  name: prometheus-canary-demo-canary
spec:
  ports:
    - port: 80
      targetPort: 3000
      name: http
  selector:
    app: prometheus-canary-demo
```

#### File: `kustomize/overlays/prod/analysis.yaml`
```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: prometheus-error-rate-analysis
spec:
  args:
    - name: service-name
  metrics:
    - name: error-rate
      interval: 30s
      successCondition: result[0] < 0.05 # Lỗi 5xx phải dưới 5%
      failureLimit: 2
      provider:
        prometheus:
          address: http://prometheus-kube-prometheus-prometheus.monitoring.svc.cluster.local:9090 # Thay bằng DNS Prometheus của bạn
          query: |
            sum(rate(http_request_duration_seconds_count{code=~"5.*"}[1m])) or vector(0)
```

---

## 🚀 PHẦN 2: Quản lý Secret trong GitOps (Bitnami Sealed Secrets)

Không bao giờ được đẩy file K8s Secret gốc chứa password lên Git. Ta sẽ cài đặt công cụ Sealed Secrets để mã hóa asymmetric các secret này. Chỉ có cụm K8s chứa Private Key mới giải mã được.

### 1. Cài đặt Sealed Secrets Controller trên cụm K8s:
```bash
# Thêm Helm Repo của Sealed Secrets
helm repo add sealed-secrets https://bitnami-labs.github.io/sealed-secrets
helm repo update

# Cài đặt controller vào namespace kube-system
helm install sealed-secrets-controller sealed-secrets/sealed-secrets -n kube-system
```

### 2. Cài đặt công cụ CLI `kubeseal` (Dành cho máy của bạn - macOS):
```bash
brew install kubeseal
```

### 3. Tạo Secret gốc tại máy cá nhân (Không được push lên Git):
Tạo file nhạy cảm `kustomize/overlays/prod/secret-raw.yaml`:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-secret
  namespace: default
type: Opaque
stringData:
  DATABASE_PASSWORD: "SuperSecureProductionPassword123"
```

### 4. Mã hóa Secret thành SealedSecret:
Chạy lệnh sau để gửi file secret gốc qua cụm K8s nhờ controller mã hóa bằng Public Key:

```bash
kubeseal --controller-name=sealed-secrets-controller \
         --controller-namespace=kube-system \
         --format=yaml \
         < kustomize/overlays/prod/secret-raw.yaml \
         > kustomize/overlays/prod/sealed-secret.yaml
```

### 5. Dọn dẹp file nhạy cảm:
Xóa ngay file chứa mật khẩu dạng rõ:

```bash
rm kustomize/overlays/prod/secret-raw.yaml
```
*Giờ bạn chỉ cần commit file `sealed-secret.yaml` đã mã hóa lên Git. Khi ArgoCD deploy file này, Sealed Secrets Controller trong cụm K8s sẽ tự động giải mã ngược lại thành một Kubernetes Secret có tên là `db-secret`.*

---

## 🚀 PHẦN 3: Đào sâu Observability & SRE Alerting (Prometheus & Grafana)

Trong phần này ta sẽ cấu hình **Multi-window Multi-burn-rate Alerting** - tiêu chuẩn vàng về Alerting trong SRE để giảm thiểu cảnh báo ảo (Alert Fatigue).

### Lý thuyết SRE Burn Rate:
*   Chúng ta cam kết chất lượng dịch vụ (**SLO**) là **99.5% requests thành công** trong vòng 30 ngày (Window).
*   **Error Budget (Ngân sách lỗi):** Cho phép tối đa **0.5%** requests bị lỗi.
*   **Burn Rate = 1:** Chúng ta tiêu thụ hết 100% ngân sách lỗi trong đúng 30 ngày.
*   **Burn Rate = 14.4:** Chúng ta tiêu thụ hết sạch ngân sách lỗi chỉ trong **50 giờ**. Nếu điều này xảy ra, ta cần phát cảnh báo ngay (Page/SMS) vì hệ thống đang lỗi nặng.
*   Công thức tính Burn Rate 1h: `Error Rate trong 1h / Error Budget`. Nếu Error Rate 1h > 7.2% (tương đương Burn Rate > 14.4), cảnh báo sẽ kích hoạt.

### 1. Định nghĩa Luật Cảnh Báo SRE Rule trong cụm K8s

#### File: `kustomize/overlays/prod/alerts.yaml`

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: prometheus-canary-demo-slo-alerts
  labels:
    role: alert-rules
    release: prometheus # Label này phải trùng với Helm release Prometheus của bạn để nó tự nạp rules
spec:
  groups:
    - name: prometheus-canary-demo-burn-rate
      rules:
        # Cảnh báo 1: Burn rate cực nhanh (Tiêu thụ sạch ngân sách lỗi trong 50 giờ)
        # 1-hour window: Burn rate > 14.4 (Lỗi > 7.2% trong 1 giờ)
        - alert: HttpErrorBudgetBurnRateRapid
          expr: |
            (
              sum(rate(http_request_duration_seconds_count{code=~"5.*"}[1h]))
              /
              (sum(rate(http_request_duration_seconds_count[1h])) + 0.001)
            ) > 0.072
          for: 2m
          labels:
            severity: critical
            tier: app
          annotations:
            summary: "Error Budget Burn Rate cực cao (Burn Rate > 14.4)"
            description: "Dịch vụ đang tiêu thụ ngân sách lỗi với tốc độ nguy hiểm. Tỷ lệ lỗi hiện tại là {{ $value | humanizePercentage }}."

        # Cảnh báo 2: Burn rate chậm hơn nhưng liên tục (Tiêu thụ sạch ngân sách lỗi trong 120 giờ)
        # 6-hour window: Burn rate > 6 (Lỗi > 3% liên tục trong 6 giờ)
        - alert: HttpErrorBudgetBurnRateSlow
          expr: |
            (
              sum(rate(http_request_duration_seconds_count{code=~"5.*"}[6h]))
              /
              (sum(rate(http_request_duration_seconds_count[6h])) + 0.001)
            ) > 0.03
          for: 15m
          labels:
            severity: warning
            tier: app
          annotations:
            summary: "Error Budget Burn Rate tăng liên tục (Burn Rate > 6)"
            description: "Dịch vụ đang có lỗi rò rỉ âm ỉ kéo dài. Tỷ lệ lỗi trong 6 giờ qua là {{ $value | humanizePercentage }}."
```

---

### 2. Cấu hình Alertmanager Gửi Cảnh báo sang Slack / Discord

Cập nhật cấu hình Alertmanager (Thường nằm trong Helm Values của `kube-prometheus-stack` hoặc cấu hình secret `alertmanager-prometheus-kube-prometheus-alertmanager` trong namespace monitoring).

Dưới đây là file cấu hình Alertmanager mẫu để chuyển tiếp các cảnh báo `critical` và `warning` về Webhook của Slack/Discord:

```yaml
global:
  resolve_timeout: 5m

route:
  group_by: ['alertname', 'namespace']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 12h
  receiver: 'discord-notifications' # Gửi mặc định vào Discord/Slack
  routes:
    - match:
        severity: critical
      receiver: 'discord-notifications'
      continue: true

receivers:
  - name: 'discord-notifications'
    slack_configs:
      - api_url: 'https://discord.com/api/webhooks/YOUR_DISCORD_WEBHOOK_URL/slack' # Đuôi /slack giúp Discord hiểu định dạng payload của Slack
        channel: '#alerts'
        send_resolved: true
        title: '[{{ .Status | toUpper }}] Cảnh báo hệ thống'
        text: >-
          {{ range .Alerts }}
            *Alert:* {{ .Annotations.summary }}
            *Severity:* {{ .Labels.severity }}
            *Description:* {{ .Annotations.description }}
          {{ end }}
```

---

### 3. Thiết kế Grafana Dashboard cho Ứng dụng
Để theo dõi Canary trực quan, bạn hãy tạo một Dashboard mới trong Grafana và thêm 3 panel với các câu lệnh PromQL sau:

1.  **Panel 1: Request Rate (RPS) - Đo lưu lượng truy cập:**
    *   **PromQL:** `sum(rate(http_request_duration_seconds_count[1m])) by (route)`
2.  **Panel 2: Error Rate (%) - Tỷ lệ lỗi:**
    *   **PromQL:** `sum(rate(http_request_duration_seconds_count{code=~"5.*"}[1m])) / (sum(rate(http_request_duration_seconds_count[1m])) + 0.001) * 100`
3.  **Panel 3: Latency P99 (Giây) - Thời gian phản hồi:**
    *   **PromQL:** `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[1m])) by (le))`

---

## 🚀 PHẦN 4: Triển Khai GitOps Đa Môi Trường Trên ArgoCD

Trong thực tế, ta sử dụng mẫu **Application-in-Application** hoặc **ApplicationSet** của ArgoCD để tự động nhận diện và deploy các môi trường từ thư mục `overlays/`.

Để đơn giản và rõ ràng, bạn hãy viết 2 file Application riêng cho `dev` và `prod` rồi apply chúng lên ArgoCD.

#### File: `argo-app-dev.yaml`
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: canary-demo-dev
  namespace: argocd
spec:
  project: default
  source:
    repoURL: 'https://github.com/<your-username>/<your-repo>.git'
    targetRevision: HEAD
    path: kustomize/overlays/dev # Điểm đến thư mục dev
  destination:
    server: 'https://kubernetes.default.svc'
    namespace: dev # Deploy vào namespace dev
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    createNamespace: true
```

#### File: `argo-app-prod.yaml`
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: canary-demo-prod
  namespace: argocd
spec:
  project: default
  source:
    repoURL: 'https://github.com/<your-username>/<your-repo>.git'
    targetRevision: HEAD
    path: kustomize/overlays/prod # Điểm đến thư mục prod
  destination:
    server: 'https://kubernetes.default.svc'
    namespace: prod # Deploy vào namespace prod
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    createNamespace: true
```

Apply cả hai ứng dụng lên cụm:
```bash
kubectl apply -f argo-app-dev.yaml
kubectl apply -f argo-app-prod.yaml
```

---

## 🚀 PHẦN 5: Xây dựng Pipeline CI/CD với GitHub Actions Chuẩn Enterprise

Để tự động hóa hoàn toàn quy trình GitOps, ta cần một pipeline CI/CD chạy trên GitHub Actions. Pipeline này sẽ tự động chạy khi bạn đẩy code (push) lên nhánh `main` hoặc `dev`, thực hiện kiểm thử, đóng gói Docker image đưa lên Docker Hub, và cuối cùng là cập nhật image tag mới vào các thư mục Kustomize (`overlays/dev/` hoặc `overlays/prod/`) để ArgoCD đồng bộ lên Kubernetes.

Hãy tạo file `.github/workflows/deploy.yml` với nội dung sau:

```yaml
name: Enterprise Multi-Env GitOps CI/CD

on:
  push:
    branches:
      - main
      - dev
  workflow_dispatch:
    inputs:
      target_env:
        description: 'Môi trường triển khai thủ công'
        required: true
        default: 'dev'
        type: choice
        options:
          - dev
          - prod

# 1. Concurrency control: Giới hạn chạy đồng thời để tránh xung đột chéo nhánh trên cùng hạ tầng/runner.
# Ta đặt tên group chung theo workflow mà không bao gồm branch name để tránh đụng độ tài nguyên khi cả main và dev deploy cùng lúc.
concurrency:
  group: ${{ github.workflow }}
  cancel-in-progress: false # Không nên cancel dở dang trong deploy để tránh tệp tin bị ghi đè dở dang

# 2. Permissions block: Áp dụng nguyên tắc đặc quyền tối thiểu (Least-Privilege)
# Mặc định tước tất cả các quyền ghi của GITHUB_TOKEN
permissions: read-all

jobs:
  test_and_audit:
    name: Test & Security Audit (Matrix Strategy)
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      # 3. Matrix strategy: Đảm bảo kiểm thử tính tương thích trên nhiều phiên bản NodeJS
      matrix:
        node-version: [18, 20]
    steps:
      - name: Checkout mã nguồn
        uses: actions/checkout@v4

      # 4. Cache dependencies: Sử dụng cơ chế cache hiện đại được tích hợp trực tiếp vào actions/setup-node
      - name: Setup NodeJS & Cấu hình Cache
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
          cache-dependency-path: app/package-lock.json

      - name: Cài đặt Dependencies
        run: |
          cd app
          npm ci

      - name: Kiểm tra lỗi bảo mật (Audit)
        run: |
          cd app
          npm audit signatures || true

  build_and_push:
    name: Build & Push Docker Image
    needs: test_and_audit
    runs-on: ubuntu-latest
    steps:
      - name: Checkout mã nguồn
        uses: actions/checkout@v4

      # 5. Docker Hub với Personal Access Token (PAT)
      - name: Đăng nhập Docker Hub (Dùng PAT)
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_PASSWORD }} # Đây phải là PAT được tạo từ Docker Hub, không dùng mật khẩu gốc

      - name: Setup Docker Buildx
        uses: docker/setup-buildx-action@v3

      # 6. Sử dụng tag SHA thay vì :latest để dễ dàng Rollback khi gặp sự cố
      - name: Build và Push Docker Image
        uses: docker/build-push-action@v5
        with:
          context: ./app
          push: true
          tags: |
            ${{ secrets.DOCKER_USERNAME }}/prometheus-canary-demo:${{ github.sha }}
            ${{ secrets.DOCKER_USERNAME }}/prometheus-canary-demo:latest

  deploy_gitops:
    name: GitOps Promote & Deploy
    needs: build_and_push
    runs-on: ubuntu-latest
    # 7. Environment & Required Reviewers: Gắn môi trường cụ thể để kích hoạt cổng phê duyệt (Review Gate) trên GitHub
    environment:
      name: ${{ github.event_name == 'workflow_dispatch' && github.event.inputs.target_env || (github.ref_name == 'main' && 'prod' || 'dev') }}
    
    # Ghi đè quyền contents: write để cho phép Actions commit và push code ngược lại Repository
    permissions:
      contents: write

    steps:
      - name: Checkout mã nguồn
        uses: actions/checkout@v4

      - name: Cập nhật Kustomize Image Tag
        run: |
          # Xác định môi trường đích
          ENV_NAME="${{ github.event_name == 'workflow_dispatch' && github.event.inputs.target_env || (github.ref_name == 'main' && 'prod' || 'dev') }}"
          echo "Triển khai lên môi trường: $ENV_NAME"
          
          # Di chuyển vào overlay của môi trường và cập nhật image mới bằng Kustomize
          cd kustomize/overlays/$ENV_NAME
          kustomize edit set image prometheus-canary-demo-placeholder=${{ secrets.DOCKER_USERNAME }}/prometheus-canary-demo:${{ github.sha }}

      - name: Commit và Push thay đổi (GitOps Sync)
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add .
          git commit -m "chore(gitops): promote image to dev/prod with tag ${{ github.sha }} [skip ci]" || exit 0
          git push origin ${{ github.ref_name }}
```

---

## 🔍 Kết quả đối chiếu và các bài kiểm tra (Verification Checklist)

Sau khi deploy thành công, bạn phải kiểm tra và xác nhận các kết quả sau để chứng minh hệ thống hoạt động đúng tiêu chuẩn doanh nghiệp:

### 1. Kiểm tra Multi-environment
*   **Ở Namespace `dev`:** Chạy lệnh `kubectl get pods -n dev`. Bạn chỉ thấy duy nhất **1 Pod** đang chạy. Không có dịch vụ stable/canary phân tách. Ứng dụng chạy version `dev-1.0.0`.
*   **Ở Namespace `prod`:** Chạy lệnh `kubectl get pods -n prod`. Bạn sẽ thấy **3 Pods** đang chạy. Ứng dụng chạy version `prod-1.0.0`.

### 2. Kiểm tra Secret Decryption (Sealed Secrets)
*   Chạy lệnh để lấy thông tin secret trong namespace `prod`:
    ```bash
    kubectl get secret db-secret -n prod -o jsonpath='{.data.DATABASE_PASSWORD}' | base64 --decode
    ```
*   **Kết quả kỳ vọng:** Output hiển thị đúng mật khẩu đã được mã hóa ở máy cá nhân: `SuperSecureProductionPassword123`.
*   Port-forward ứng dụng prod: `kubectl port-forward svc/prometheus-canary-demo -n prod 8080:80`.
*   Truy cập `http://localhost:8080`. Trình duyệt hiển thị:
    `Hello from the Canary Demo App! Version: prod-1.0.0 | Secret Loaded: YES (Encrypted via SealedSecret)`

### 3. Giả lập thảm họa và Tự động Rollback + Alerting về Discord/Slack
1.  Đẩy bản build mới bị lỗi lên môi trường `prod` (Ví dụ sửa Dockerfile thành `VERSION=prod-2.0.0-buggy`). Pipeline CI tự động update code và ArgoCD sẽ đồng bộ.
2.  Argo Rollout bắt đầu cập nhật và chuyển 20% traffic sang bản lỗi.
3.  Tạo request liên tục vào service canary:
    ```bash
    kubectl port-forward svc/prometheus-canary-demo-canary -n prod 8081:80
    ```
    Tại terminal khác:
    ```bash
    while true; do curl http://localhost:8081/; sleep 0.2; done
    ```
4.  Gọi endpoint lỗi: `curl http://localhost:8081/fail`.
5.  **Quan sát kết quả:**
    *   **Argo Rollouts:** Sau 30s-1 phút, AnalysisTemplate phát hiện tỷ lệ lỗi HTTP 500 tăng vọt, chuyển sang trạng thái `Degraded` và ngay lập tức rollback cụm `prod` về `prod-1.0.0`.
    *   **Grafana:** Panel Error Rate hiển thị biểu đồ cột tăng vọt, sau đó giảm dần về 0 khi rollback hoàn thành.
    *   **Prometheus Alertmanager:** Sau 2 phút xảy ra lỗi, một cảnh báo `HttpErrorBudgetBurnRateRapid` (Severity: critical) được sinh ra và gửi trực tiếp một tin nhắn chi tiết kèm thông báo lỗi về kênh Slack/Discord của bạn!

### 4. Kiểm tra luồng CI/CD (GitHub Actions)
*   **Kiểm tra Concurrency (Xếp hàng):** Thử đẩy liên tiếp 2 commit lên nhánh `dev` và `main`. Xác nhận trên tab Actions của GitHub rằng luồng sau phải được xếp vào hàng đợi chờ luồng trước hoàn thành chứ không chạy song song đè lên nhau.
*   **Kiểm tra Caching:** Quan sát log của job `test_and_audit` từ lần chạy thứ 2. Dòng chữ `Cache hit` xuất hiện và thời gian cài đặt npm giảm mạnh (chỉ mất vài giây).
*   **Kiểm tra Permissions:** Nhấp vào job `test_and_audit` hoặc `build_and_push` để kiểm tra quyền hạn của `GITHUB_TOKEN`, xác nhận chỉ có quyền đọc (`read`), riêng job `deploy_gitops` được cấp thêm quyền ghi (`contents: write`).
*   **Kiểm tra Docker Hub PAT & SHA Tag:** Đăng nhập vào tài khoản Docker Hub của bạn, kiểm tra image xem có tag ứng với mã băm SHA của commit (`${{ github.sha }}`) hay không.
*   **Kiểm tra Review Gate (Environment):** Khi đẩy code lên `main` để deploy lên `prod`, kiểm tra xem GitHub Actions có dừng lại để chờ bạn bấm nút **Approve** trước khi thực thi job `deploy_gitops` hay không.

*Chúc bạn học tập hiệu quả! Đừng quên xem file `cleanup.md` để dọn sạch tài nguyên sau khi hoàn thành bài Lab nâng cao này.*

