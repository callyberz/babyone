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
    onSuccess: (r) => qc.setQueryData(meKey, r.user),
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

export { UnauthenticatedError };
