import { Injectable } from '@angular/core';
import { HotToastService } from '@ngneat/hot-toast';
import { isExtension } from '../../utils';
import { Store } from '@ngrx/store';
import * as fromRoot from '../../store';
import { IDictionary } from 'app/interfaces/shared';
import { first } from 'rxjs/operators';

interface NotifyOptions {
  data?: {
    url?: string,
  },
  disableTimeOut?: boolean;
};

type NotifyType = 'success' | 'error' | 'warning' | 'show';
@Injectable()
export class NotifyService {

  extensionNotifications: IDictionary = {};

  constructor(
    private toast: HotToastService,
    private store: Store<fromRoot.State>
  ) {
    this.manageExtensionNotifications();
  }

  success(message: string, title = 'Altair', opts: NotifyOptions = {}) {
    this.exec('success', message, title, opts);
  }
  error(message: string, title = '', opts: NotifyOptions = {}) {
    this.exec('error', message, title, opts);
  }
  warning(message: string, title = '', opts: NotifyOptions = {}) {
    this.store.select(state => state.settings['alert.disableWarnings']).pipe(
      first(),
    ).subscribe(disableWarnings => {
      if (!disableWarnings) {
        return this.exec('warning', message, title, opts);
      }
    });
  }
  info(message: string, title = '', opts: NotifyOptions = {}) {
    this.exec('show', message, title, opts);
  }
  exec(type: NotifyType, message: string, title: string, opts: NotifyOptions = {}) {
    let toastContent = message;

    if (title) {
      toastContent = `<div><b>${title}</b></div>${toastContent}`;
    }

    if (opts.data?.url) {
      toastContent = `${toastContent}<a href="${opts.data.url}" target="_blank">Link</a>`;
    }
    return this.toast[type](message, {
      id: message,
      autoClose: !opts.disableTimeOut,
    })
    // const toast: ActiveToast<any> = this.toastr[type](message, title, opts);
    // if (opts.data && opts.data.url) {
    //   toast.onTap.subscribe(_toast => {
    //     window.open(opts.data.url, '_blank');
    //   })
    // }
    // return toast;
  }

  pushNotify(message: string, title = 'Altair', opts: any = {}) {
    if (isExtension) {
      return this.extensionPushNotify(message, title, opts);
    } else {
      return this.electronPushNotify(message, title, opts);
    }
  }

  electronPushNotify(message: string, title = 'Altair', opts: any = {}) {
    this.store.select(state => state.settings.disablePushNotification).pipe(first()).toPromise().then(disablePushNotification => {
      if (disablePushNotification) {
        return;
      }

      const myNotification = new Notification(title, {
        body: message
      });
      if (opts) {
        myNotification.onclick = opts.onclick;
      }

      return myNotification;
    });
  }

  extensionPushNotify(message: string, title = 'Altair', opts: any = {}) {
    this.store.select(state => state.settings.disablePushNotification).pipe(first()).toPromise().then(disablePushNotification => {
      if (disablePushNotification) {
        return;
      }

      (window as any).chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/img/logo.png',
        title,
        message
      }, (notifId: string) => {
        if (opts) {
          this.extensionNotifications[notifId] = {};

          if (opts.onclick) {
            this.extensionNotifications[notifId].onclick = opts.onclick;
          }
        }
      });
    });
  }

  private manageExtensionNotifications() {
    if (!isExtension) {
      return;
    }

    // Handle click events
    (window as any).chrome.notifications.onClicked.addListener((notifId: string) => {
      if (this.extensionNotifications[notifId] && this.extensionNotifications[notifId].onclick) {
        this.extensionNotifications[notifId].onclick();
      }
    });

    // Handle closed notifications
    (window as any).chrome.notifications.onClosed.addListener((notifId: string) => {
      if (this.extensionNotifications[notifId]) {
        delete this.extensionNotifications[notifId];
      }
    });
  }
}
