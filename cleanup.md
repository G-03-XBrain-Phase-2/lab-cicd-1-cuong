# Hướng dẫn dọn dẹp tài nguyên (Advanced Cleanup Guide)

Sau khi hoàn thành bài Lab nâng cao này, hãy thực hiện dọn dẹp tài nguyên theo trình tự dưới đây để khôi phục cụm K8s về trạng thái sạch ban đầu.

---

## Bước 1: Xóa các ứng dụng ArgoCD
Xóa các ứng dụng ArgoCD sẽ tự động xóa tất cả tài nguyên con nằm trong namespace `dev` và `prod` (bao gồm Rollout, Service, ConfigMap, Secrets, SealedSecrets, PrometheusRule):

```bash
# Xóa thông qua file manifest
kubectl delete -f argo-app-dev.yaml
kubectl delete -f argo-app-prod.yaml

# Hoặc xóa trực tiếp trên ArgoCD
kubectl delete app canary-demo-dev -n argocd
kubectl delete app canary-demo-prod -n argocd
```

---

## Bước 2: Xóa các Namespace `dev` và `prod`
Việc xóa namespace giúp đảm bảo không còn bất cứ tài nguyên mồ côi nào sót lại:

```bash
kubectl delete ns dev prod
```

---

## Bước 3: Gỡ bỏ Sealed Secrets Controller
Gỡ cài đặt Sealed Secrets Controller khỏi cụm K8s:

```bash
# Gỡ cài đặt Helm release
helm uninstall sealed-secrets-controller -n kube-system

# (Tùy chọn) Xóa Custom Resource Definitions (CRDs) của Sealed Secrets
kubectl delete crd sealedsecrets.bitnami.com
```

---

## Bước 4: Xóa các cấu hình cảnh báo của Prometheus (Nếu có cài đặt thêm)
Nếu bạn đã nạp Alertmanager config trực tiếp bằng tay thông qua Kubernetes Secret:
```bash
# Khôi phục secret Alertmanager mặc định (nếu cần) hoặc xóa đi
kubectl delete secret alertmanager-prometheus-kube-prometheus-alertmanager -n monitoring
```

---

## Bước 5: Xóa Docker Image trên Registry
*   Xóa image tag đã build trong repository AWS ECR / Docker Hub để tiết kiệm dung lượng lưu trữ.
