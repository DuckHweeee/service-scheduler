import { errorMessage } from '../../api/client.js';
import { useDealerships, useServiceTypes, useVehicles } from '../../api/hooks.js';
import { CUSTOMER_ID } from '../../config.js';
import { BookForm } from './BookForm.js';
import styles from './Book.module.css';

/** Loads reference data, then renders the booking flow. */
export function BookScreen() {
  const dealerships = useDealerships();
  const serviceTypes = useServiceTypes();
  const vehicles = useVehicles(CUSTOMER_ID);

  const failed = dealerships.error ?? serviceTypes.error ?? vehicles.error;
  const ready = dealerships.data && serviceTypes.data && vehicles.data;

  if (
    ready &&
    dealerships.data.items.length &&
    vehicles.data.items.length &&
    serviceTypes.data.items.length
  ) {
    return (
      <BookForm
        dealerships={dealerships.data.items}
        serviceTypes={serviceTypes.data.items}
        vehicles={vehicles.data.items}
      />
    );
  }

  return (
    <main className={styles.main}>
      {failed ? (
        <div role="alert" className={styles.warn}>
          <p>{errorMessage(failed)}</p>
          <button
            type="button"
            className={styles.retry}
            onClick={() => {
              for (const q of [dealerships, serviceTypes, vehicles]) if (q.isError) void q.refetch();
            }}
          >
            Try again
          </button>
        </div>
      ) : ready ? (
        <p role="alert" className={styles.warn}>
          Booking is not available right now.
        </p>
      ) : (
        <p role="status" className={styles.muted}>
          Loading booking options…
        </p>
      )}
    </main>
  );
}
