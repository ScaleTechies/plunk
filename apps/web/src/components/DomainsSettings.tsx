import {useEffect, useState} from 'react';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {DomainSchemas} from '@plunk/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  IconSpinner,
  Input,
} from '@plunk/ui';
import {AnimatePresence, motion} from 'framer-motion';
import {CheckCircle2, Globe, RefreshCw, Trash2, XCircle} from 'lucide-react';

import {useAddDomain, useCheckDomainVerification, useDomains, useRemoveDomain} from '../lib/hooks/useDomains';

interface DomainsSettingsProps {
  projectId: string;
}

export function DomainsSettings({projectId}: DomainsSettingsProps) {
  const {domains, mutate: mutateDomains, isLoading} = useDomains(projectId);
  const {addDomain} = useAddDomain();
  const {checkVerification} = useCheckDomainVerification();
  const {removeDomain} = useRemoveDomain();

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [checkingVerification, setCheckingVerification] = useState<string | null>(null);
  const [lastVerificationCheck, setLastVerificationCheck] = useState<{[key: string]: number}>({});
  const [cooldownSeconds, setCooldownSeconds] = useState<{[key: string]: number}>({});
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [domainToRemove, setDomainToRemove] = useState<{id: string; name: string} | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<{
    [key: string]: boolean | string | {tokens: string[] | null; status: string; verified: boolean};
  }>({});

  const form = useForm<{domain: string}>({
    resolver: zodResolver(DomainSchemas.create.omit({projectId: true})),
    defaultValues: {
      domain: '',
    },
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const newCooldowns: {[key: string]: number} = {};
      let hasActiveCooldowns = false;

      Object.keys(lastVerificationCheck).forEach(domainId => {
        const lastCheck = lastVerificationCheck[domainId];
        if (lastCheck === undefined) return;

        const elapsedSeconds = Math.floor((now - lastCheck) / 1000);
        const remainingSeconds = 10 - elapsedSeconds;

        if (remainingSeconds > 0) {
          newCooldowns[domainId] = remainingSeconds;
          hasActiveCooldowns = true;
        }
      });

      setCooldownSeconds(newCooldowns);

      if (!hasActiveCooldowns && Object.keys(newCooldowns).length === 0) {
        clearInterval(interval);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [lastVerificationCheck]);

  const showMessage = (type: 'success' | 'error', message: string) => {
    if (type === 'success') {
      setSuccessMessage(message);
      setErrorMessage(null);
      setTimeout(() => setSuccessMessage(null), 5000);
    } else {
      setErrorMessage(message);
      setSuccessMessage(null);
    }
  };

  const onSubmit = async (values: {domain: string}) => {
    try {
      setErrorMessage(null);
      await addDomain(projectId, values.domain);
      await mutateDomains();
      form.reset();
      showMessage('success', `Domain ${values.domain} added successfully.`);
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to add domain');
    }
  };

  const handleCheckVerification = async (domainId: string) => {
    const now = Date.now();
    const lastCheck = lastVerificationCheck[domainId];
    if (lastCheck) {
      const elapsedSeconds = Math.floor((now - lastCheck) / 1000);
      if (elapsedSeconds < 10) {
        return;
      }
    }

    try {
      setCheckingVerification(domainId);
      setLastVerificationCheck(prev => ({
        ...prev,
        [domainId]: now,
      }));

      const status = await checkVerification(domainId);

      setVerificationStatus(prev => ({
        ...prev,
        [domainId]: status,
      }));

      await mutateDomains();

      if (status.verified) {
        showMessage('success', `Domain ${status.domain} is verified.`);
      } else {
        showMessage('error', `Domain ${status.domain} is not verified in Plunk yet.`);
      }
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to check verification');
    } finally {
      setCheckingVerification(null);
    }
  };

  const handleRemoveDomain = async () => {
    if (!domainToRemove) return;

    try {
      await removeDomain(domainToRemove.id);
      await mutateDomains();
      showMessage('success', `Domain ${domainToRemove.name} removed successfully`);
    } catch (error) {
      showMessage('error', error instanceof Error ? error.message : 'Failed to remove domain');
    } finally {
      setDomainToRemove(null);
    }
  };

  const getDomainStatus = (domain: {id: string; verified: boolean; dkimTokens: unknown}) => {
    const status = verificationStatus[domain.id];
    if (status && typeof status === 'object' && 'verified' in status) {
      return status;
    }
    return {verified: domain.verified, tokens: domain.dkimTokens, status: domain.verified ? 'Success' : 'Pending'};
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add Domain</CardTitle>
          <CardDescription>Add a custom domain to send emails from</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="domain"
                render={({field}) => (
                  <FormItem>
                    <FormLabel>Domain</FormLabel>
                    <FormControl>
                      <Input placeholder="example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
                Verify this domain in ZeptoMail before sending from it. This private fork stores trusted domains as
                verified in Plunk and uses ZeptoMail as the source of truth for DNS records.
              </div>

              <AnimatePresence mode="wait">
                {successMessage && (
                  <motion.div
                    initial={{opacity: 0, y: -10}}
                    animate={{opacity: 1, y: 0}}
                    exit={{opacity: 0}}
                    className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800"
                  >
                    {successMessage}
                  </motion.div>
                )}
                {errorMessage && (
                  <motion.div
                    initial={{opacity: 0, y: -10}}
                    animate={{opacity: 1, y: 0}}
                    exit={{opacity: 0}}
                    className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800"
                  >
                    {errorMessage}
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex justify-end">
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? 'Adding...' : 'Add Domain'}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your Domains</CardTitle>
          <CardDescription>Manage your verified domains</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <IconSpinner />
            </div>
          ) : !domains || domains.length === 0 ? (
            <EmptyState
              icon={Globe}
              title="No domains added"
              description="Add a custom domain above to send emails from your own address."
            />
          ) : (
            <div className="space-y-4">
              {domains.map(domain => {
                const status = getDomainStatus(domain);
                return (
                  <div key={domain.id} className="border border-neutral-200 rounded-lg p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <h3 className="font-medium text-neutral-900">{domain.domain}</h3>
                        {status.verified ? (
                          <Badge variant="success" className="flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Verified
                          </Badge>
                        ) : (
                          <Badge variant="warning" className="flex items-center gap-1">
                            <XCircle className="h-3 w-3" />
                            Pending
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCheckVerification(domain.id)}
                          disabled={checkingVerification === domain.id || (cooldownSeconds[domain.id] ?? 0) > 0}
                          className="min-w-[80px]"
                        >
                          {checkingVerification === domain.id ? (
                            <IconSpinner size="sm" />
                          ) : (cooldownSeconds[domain.id] ?? 0) > 0 ? (
                            <span className="text-xs">{cooldownSeconds[domain.id]}s</span>
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="destructiveGhost"
                          size="sm"
                          onClick={() => {
                            setDomainToRemove({id: domain.id, name: domain.domain});
                            setShowRemoveDialog(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={showRemoveDialog}
        onOpenChange={setShowRemoveDialog}
        onConfirm={handleRemoveDomain}
        title="Remove Domain"
        description={`Are you sure you want to remove ${domainToRemove?.name}?`}
        confirmText="Remove"
        variant="destructive"
      />
    </div>
  );
}
