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

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.updateProfile,
    onSuccess: (response) => {
      qc.setQueryData(meKey, response.user);
      void qc.invalidateQueries({ queryKey: caregiversKey });
    },
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.changePassword,
    onSuccess: () => qc.invalidateQueries({ queryKey: sessionsKey }),
  });
}

export const sessionsKey = ["auth-sessions"] as const;

export function useSessions(enabled: boolean) {
  return useQuery({
    queryKey: sessionsKey,
    queryFn: () => api.listSessions().then((response) => response.sessions),
    enabled,
    staleTime: 0,
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.revokeSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: sessionsKey }),
  });
}

export const pendingInvitesKey = ["pending-invites"] as const;

export function usePendingInvites(enabled: boolean) {
  return useQuery({
    queryKey: pendingInvitesKey,
    queryFn: () =>
      api.listPendingInvites().then((response) => response.invites),
    enabled,
    staleTime: 0,
  });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createInvite,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: pendingInvitesKey }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.revokeInvite,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: pendingInvitesKey }),
  });
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
