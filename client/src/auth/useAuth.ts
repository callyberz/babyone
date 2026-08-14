import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, UnauthenticatedError } from "../api";

export const meKey = ["me"] as const;

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: () => api.me().then((r) => r.user),
    retry: false,
    staleTime: Infinity,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      api.login(email, password),
    onSuccess: (r) => qc.setQueryData(meKey, r.user),
  });
}

export function useSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.signup,
    onSuccess: (r) => {
      window.history.replaceState({}, "", "/");
      qc.setQueryData(meKey, r.user);
    },
  });
}

export function useResetPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.resetPassword,
    onSuccess: (response) => {
      window.history.replaceState({}, "", "/");
      qc.setQueryData(meKey, response.user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => qc.clear(),
  });
}

export function useCreateInvite() {
  return useMutation({ mutationFn: api.createInvite });
}

export const caregiversKey = ["caregivers"] as const;

export function useCaregivers(enabled: boolean) {
  return useQuery({
    queryKey: caregiversKey,
    queryFn: () => api.listCaregivers().then((response) => response.caregivers),
    enabled,
    staleTime: 0,
  });
}

export function useCreatePasswordReset() {
  return useMutation({ mutationFn: api.createPasswordReset });
}

export { UnauthenticatedError };
