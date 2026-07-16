import { SftpBrowserView } from "./SftpBrowserView";
import {
  useSftpBrowserViewModel,
  type SftpBrowserPresenterProps,
} from "./sftpBrowserViewModel";

/** 连接 target-bound controller 与无业务状态的 SFTP Browser View。 */
export function SftpBrowserPresenter(props: SftpBrowserPresenterProps) {
  const viewModel = useSftpBrowserViewModel(props);
  return <SftpBrowserView {...props} viewModel={viewModel} />;
}
